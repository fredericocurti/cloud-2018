// @ts-check
const aws = require('aws-sdk')
const express = require('express')
const bodyParser = require('body-parser');
const { fork } = require('child_process');
const { InstanceManager } = require('../aps3')
const app = express()

app.use(bodyParser.json())
aws.config.update({ region: 'us-east-1' })

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
        return acc.concat(item.Instances.filter(i => i.State.Name === 'running'))
    }, [])

    console.log(`There are ${runningInstances.length} running instances`)
    return runningInstances
}

app.all('*', (req, res, next) => {
    const redirectUrl = 'http://'+ pickRandom(Object.keys(publicIps)) + ':' + remotePort + req.originalUrl
    console.log(redirectUrl)
    res.status(200).redirect(redirectUrl)
})

const main = async () => {
    const instanceManager = await new InstanceManager('fred-aps3', 'APS-fred', 'fredericocurti')
    // await instanceManager.createInstances(2)
    const instanceAmountTarget = 3
    let replaceQueue = []
    
    // await instanceManager.checkAndTerminateRunningInstances()
    // await instanceManager.createInstances(instanceAmountTarget)

    let runningInstances = await listRunningInstances('fredericocurti')
    if (runningInstances.length > instanceAmountTarget) {
        console.log('There are more instances than desired!, terminating extras...')
        let instancesToTerminate = runningInstances.filter((instance, index) => index >= instanceAmountTarget)
        await Promise.all(instancesToTerminate.map(i => instanceManager.terminateInstance(i.InstanceId)))
        runningInstances = await listRunningInstances('fredericocurti')
    }

    if (runningInstances.length < instanceAmountTarget) {
        if (runningInstances.length === 0) {
            console.log('There are no running instances!')
        }
        console.log('There are less instances than desired!, creating more...')
        await instanceManager.createInstances(instanceAmountTarget - runningInstances.length)
        runningInstances = await listRunningInstances('fredericocurti')
    }

    runningInstances.forEach((i) => {
        publicIps[i.PublicIpAddress] = i.State.Name
    })

    const healthCheckProcess = fork('./healthcheck.js');

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

                runningInstances = await listRunningInstances('fredericocurti')
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





