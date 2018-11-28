// @ts-check
const aws = require('aws-sdk')
const express = require('express')
const bodyParser = require('body-parser');
const { fork } = require('child_process');
const { InstanceManager } = require('./InstanceManager')
const path = require('path')
const app = express()

/** @type {{_: [], count: number, sg: string, kp: string, owner: string, sak: string, aki: string}} */
// @ts-ignore
const argv = require('minimist')(process.argv.slice(2))
let argval = ['count', 'sg', 'kp', 'owner', 'sak', 'aki']
argval.every((i) => {
    if (!(i in argv)) {
        throw `Key ${i} missing in arguments!`
    }
    return (i in argv)
})

app.use(bodyParser.json())
aws.config.update({ region: 'us-east-1', accessKeyId: argv.aki, secretAccessKey: argv.sak})

const ec2 = new aws.EC2()
const remotePort = 5000
let publicIps = {}

function pickRandom(items) {
    return items[Math.floor(Math.random()*items.length)];
}

const listRunningInstances = async (instanceOwner) => {
    let instancesWithSameTag = await ec2.describeInstances({
        Filters: [
            { Name: 'tag:Owner', Values: [instanceOwner] }
        ]
    }).promise()

    let runningInstances = instancesWithSameTag.Reservations.reduce((acc, item) => {
        return acc.concat(item.Instances.filter(i => i.State.Name === 'running' && !i.Tags.find(t => t.Value === 'loadbalancer' )))
    }, [])

    console.log(`There are ${runningInstances.length} running instances`)
    return runningInstances
}

app.all('*', (req, res, next) => {
    const redirectUrl = 'http://'+ pickRandom(Object.keys(publicIps)) + ':' + remotePort + req.originalUrl
    console.log('Redirecting to', redirectUrl)
    res.redirect(307, redirectUrl)
})

const main = async () => {
    console.log('--Args from cl:', argv)
    const owner = argv.owner
    const instanceAmountTarget = argv.count
    let replaceQueue = []

    try {
        let r = await ec2.describeInstances({
            Filters: [{Name: 'tag:Owner', Values: [owner]}]
        }).promise()
        console.log('Credentials are valid!')
    } catch (error) {
        if (error.code === 'AuthFailure') {
            throw 'Failed authenticating! Please check credentials'
        }
        throw error
    }

    const instanceManager = await new InstanceManager(argv.kp+'-worker', argv.kp+'-worker', argv.owner)
    
    let runningInstances = await listRunningInstances(owner)
    if (runningInstances.length > instanceAmountTarget) {
        console.log('There are more instances than desired!, terminating extras...')
        let instancesToTerminate = runningInstances.filter((instance, index) => index >= instanceAmountTarget)
        await Promise.all(instancesToTerminate.map(i => instanceManager.terminateInstance(i.InstanceId)))
        runningInstances = await listRunningInstances(owner)
    }

    if (runningInstances.length < instanceAmountTarget) {
        if (runningInstances.length === 0) {
            console.log('There are no running instances!')
        }
        console.log('There are less instances than desired!, creating more...')
        await instanceManager.createInstances(instanceAmountTarget - runningInstances.length)
        runningInstances = await listRunningInstances(owner)
    }

    runningInstances.forEach((i) => {
        publicIps[i.PublicIpAddress] = i.State.Name
    })

    const healthCheckProcess = fork(path.join(__dirname, './healthcheck.js'));

    healthCheckProcess.on('message', async(msg) => {
        console.log('Message from child:', msg);
        if(msg.type === 'REPLACE') {
            let instanceIdToBeReplaced = msg.payload
            if (!replaceQueue.find((i) => i === instanceIdToBeReplaced)) {
                replaceQueue.push(instanceIdToBeReplaced)
                
                let instanceToBeReplaced = runningInstances.find((ri) => ri.InstanceId === instanceIdToBeReplaced)
                delete publicIps[instanceToBeReplaced.PublicIpAddress]
                
                await instanceManager.terminateInstance(instanceIdToBeReplaced)
                await instanceManager.createInstances(1)

                runningInstances = await listRunningInstances(owner)
                runningInstances.forEach((i) => {
                    publicIps[i.PublicIpAddress] = i.State.Name
                })

                healthCheckProcess.send({
                    type: 'UPDATE',
                    payload: {
                        runningInstances
                    }
                })

                setTimeout(() => {
                    replaceQueue = replaceQueue.filter((el) => el !== instanceIdToBeReplaced)
                    console.log('Replacing:\n', replaceQueue)
                }, 15000)
                
            }
            console.log('Replacing:\n', replaceQueue)
        }
    });

    healthCheckProcess.send({
        type: 'INIT',
        payload: {
            remotePort,
            runningInstances,
            instanceAmount: instanceAmountTarget
        }
    })

    app.listen(5000, () => {
        console.log(publicIps)
        console.log('CatchAll server listening on port', 5000)
    })
}

main()





