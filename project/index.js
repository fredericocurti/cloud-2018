// @ts-check
// This file must send this project to the cloud and run the Load Balancer

const readline = require('readline');
const aws = require('aws-sdk')
const { InstanceManager } = require('./InstanceManager')

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

async function main() {
    // const akid = await askQuestion("-> Please enter your AWS Access Key ID: ");
    // const sak = await askQuestion("-> Please enter your AWS Secret Access Key: ");
    // const username = await askQuestion("-> Please enter your username: ");
    // const keyPairName = await askQuestion("-> Please enter the desired keypair name: ");
    // const securityGroupName = await askQuestion("-> Please enter the desired Security Group name: ");
    let nInstances = await askQuestion("-> How many instances would you like? ");
    nInstances = parseInt(nInstances)

    const { akid, sak, username, keyPairName, securityGroupName } = require('./cred')
    let waiterResult
    let previousInstances

    aws.config.update({ region: 'us-east-1', accessKeyId: akid, secretAccessKey: sak })
    const ec2 = new aws.EC2()

    try {
        previousInstances = await Promise.all([
            ec2.describeInstances({ Filters: [{ Name: 'key-name', Values: [keyPairName] }] }).promise(),
            ec2.describeInstances({ Filters: [{ Name: 'tag:Owner', Values: [username] }] }).promise(),
            ec2.describeInstances({ Filters: [{ Name: 'group-name', Values: [securityGroupName]}] }).promise(),
        ])

    } catch (error) {
        console.log('[Error] Failed to authenticate user')
        process.exit(0)
    }
    
    console.log('Authentication Successfull')
    
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
    try {
        waiterResult = await ec2.waitFor('instanceRunning', {
            InstanceIds: [loadBalancerSubmission.Instances[0].InstanceId]
        }).promise()
        console.log('Load balancer deployed! PublicIp:', waiterResult.Reservations[0].Instances[0].PublicIpAddress)    
    } catch (error) {
        throw error
    }
}

main()



