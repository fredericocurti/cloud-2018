// @ts-check
// This file must send this project to the cloud and run the Load Balancer

const readline = require('readline');
const aws = require('aws-sdk')
const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')

const { InstanceManager } = require('./InstanceManager')

const argv = require('minimist')(process.argv.slice(2))

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

async function waitForChildInstances(ec2, ownerName, nInstances){
    return new Promise((resolve, reject) => {
        let checkInterval = setInterval(async () => {
            let res = await ec2.describeInstances({
                Filters: [
                    { Name: 'tag:Owner', Values: [ownerName] },
                    { Name: 'tag:Type', Values: ['worker'] }],
            }).promise()
    
            let ready = {}
    
            /** @type {import('aws-sdk').EC2.Instance[]} */
            let childInstances = []
    
            res.Reservations.forEach(r => {
                childInstances = childInstances.concat(r.Instances.filter(r => r.State.Name === 'running'))
            })
    
            // console.log(childInstances)
            console.log('Waiting...')
    
            childInstances.forEach(async(i) => {
                // console.log(i.InstanceId)
                try {
                    // @ts-ignore
                    let s = await fetch(`http://${i.PublicIpAddress}:5000/healthcheck`)    
                    if (s.status === 200) {
                        ready[i.InstanceId] = true
                    } else {
                        ready[i.InstanceId] = i.State.Name
                    }
                } catch (error) {
                    ready[i.InstanceId] = error.message
                }
                let allRunning = Object.values(ready).every((i) => i === true)
                if (allRunning && Object.keys(ready).length === nInstances) {
                    console.log(ready)
                    clearInterval(checkInterval)
                    resolve()
                }
            })
        }, 5000)
    })
}

async function main() {
    let akid, sak, username, keyPairName, securityGroupName
    try {
        let credentials = require('./credentials')  
        akid = credentials.akid,
        sak = credentials.sak,
        username = credentials.username,
        keyPairName = credentials.keyPairName,
        securityGroupName = credentials.securityGroupName 
    } catch (error) {
        console.log('Couldnt find credentials.js, please insert them below:')
        akid = await askQuestion("-> Please enter your AWS Access Key ID: ");
        sak = await askQuestion("-> Please enter your AWS Secret Access Key: ");
        username = await askQuestion("-> Please enter your username: ");
        keyPairName = await askQuestion("-> Please enter the desired keypair name: ");
        securityGroupName = await askQuestion("-> Please enter the desired Security Group name: ");
        console.log("These credentials are now saved for future use. They're also ignored on git")
        fs.writeFileSync(path.join(__dirname, 'credentials.js'),`
module.exports = {
    akid: '${akid}',
    sak: '${sak}',
    username: '${username}',
    keyPairName: '${keyPairName}',
    securityGroupName: '${securityGroupName}'
}`)
    }

    aws.config.update({ region: 'us-east-1', accessKeyId: akid, secretAccessKey: sak })
    const ec2 = new aws.EC2()
            
    let waiterResult
    let previousInstances

    try {
        previousInstances = await Promise.all([
            ec2.describeInstances({ Filters: [{ Name: 'key-name', Values: [keyPairName] }] }).promise(),
            ec2.describeInstances({ Filters: [{ Name: 'tag:Owner', Values: [username] }] }).promise(),
            ec2.describeInstances({ Filters: [{ Name: 'group-name', Values: [securityGroupName]}] }).promise(),
        ])

    } catch (error) {
        console.log('[Error] Failed to authenticate user. Deleting credentials.js')
        fs.unlinkSync(path.join(__dirname, 'credentials.js'))
        process.exit(0)
    }

    console.log('Authentication Successfull')

    
    if ('purge' in argv) {
        const instanceManager = await new InstanceManager(keyPairName, securityGroupName, username, akid, sak)
        await instanceManager.purge()
        try {
            fs.unlinkSync(path.join(__dirname, 'credentials.js'))
            console.log('Deleted credentials.js')
        } catch (error) {
            console.log(error)
        }
        process.exit()
    }

    let nInstances = await askQuestion("-> How many instances would you like? ");
    nInstances = parseInt(nInstances)
    if (isNaN(nInstances) || nInstances < 1 || nInstances > 10) {
        console.log('Invalid number of instances!')
        process.exit()
    }
    
    let previousInstancesCount = 0
    let pi = []
    previousInstances.forEach(r => r.Reservations.forEach(r => r.Instances.forEach(i => {
        if (pi.find(e => e === i.InstanceId)) {
        } else {
            console.log(i.InstanceId, '-',  i.State.Name)
            previousInstancesCount ++
        }
        pi.push(i.InstanceId)
    })))

    if (previousInstancesCount > 0) {
        const okToDelete = await askQuestion('These instances matched any of the params provided, and will be terminated, OK? (Y/n) ')
        if (okToDelete !== '' && okToDelete !== 'y' && okToDelete !== 'Y') {
            console.log('Bye ;(')
            process.exit(1)
        }
    }

    const instanceManager = await new InstanceManager(keyPairName, securityGroupName, username, akid, sak)
    await instanceManager.checkAndTerminateRunningInstances()

    console.log('-> Deploying Load Balancer')

    let loadBalancerSubmission = await ec2.runInstances({
        TagSpecifications: [{
            Tags: [
                { Key: 'Owner', Value: instanceManager.ownerName },
                { Key: 'Type', Value: 'loadbalancer' }
            ],
            ResourceType: 'instance' 
        }],
        SecurityGroupIds: [instanceManager.securityGroup.GroupId],
        MaxCount: 1,
        MinCount: 1,
        InstanceType: 't2.micro',
        ImageId: 'ami-0ac019f4fcb7cb7e6',
        KeyName: instanceManager.keyPair.KeyName,
        UserData: Buffer.from(`#!/bin/bash
sudo apt -y update
curl -sL https://deb.nodesource.com/setup_10.x | sudo bash -

mkdir /home/ubuntu/.aws
echo [default] >> /home/ubuntu/.aws/credentials
echo [default] >> /home/ubuntu/.aws/config

echo region = us-east-1 >> /home/ubuntu/.aws/config
echo aws_access_key_id = ${akid} >> /home/ubuntu/.aws/credentials
echo aws_secret_access_key = ${sak} >> /home/ubuntu/.aws/credentials

sudo apt -y install nodejs
git clone https://github.com/fredericocurti/cloud-2018 /home/ubuntu/cloud-2018
cd /home/ubuntu/cloud-2018/project && npm install
sudo node /home/ubuntu/cloud-2018/project/LoadBalancer.js --count ${nInstances} --sg ${securityGroupName} --kp ${keyPairName} --owner ${username} --aki ${akid} --sak ${sak}`)
.toString('base64')
    }).promise()

    console.log(loadBalancerSubmission)
    console.log('Please wait for the load balancer to become responsive')
    try {
        waiterResult = await ec2.waitFor('instanceRunning', {
            InstanceIds: [loadBalancerSubmission.Instances[0].InstanceId]
        }).promise()
        let resultIp = waiterResult.Reservations[0].Instances[0].PublicIpAddress
        console.log('🎉 Load balancer deployed!\nPublicIp:', resultIp)    
        console.log('Please allow for some time while the worker instances are spawned')
        await waitForChildInstances(ec2, username, nInstances)
        console.log('All new instances are running and healthchecked!')
        console.log('You can try consuming the service with the program in ../aps2')
        console.log(`by pasting http://${resultIp}:5000 into the $ source configaddr.sh prompt`)
    } catch (error) {
        throw error
    }
}

main()



