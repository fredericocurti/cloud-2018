// @ts-check
const log = (...args) => console.log('[HS]', ...args)
const message = (...args) => process.send(...args)
const fetch = require('node-fetch')
const { InstanceManager } = require('../aps3')

/**
 * @type {import('aws-sdk').EC2.InstanceList} *
 */
let runningInstances = []


let remotePort = 5000
let instanceAmount
let checkInterval

const checkHealth = async (ip) => {
    return new Promise(async (resolve, reject) => {
        let requestExpired = setTimeout(() => {
            reject('TIMEOUT')
        }, 5000)

        try {
            // @ts-ignore
            let check = await fetch(`http://${ip}:${remotePort}/healthcheck`, {
                method: 'GET'
            })
            check = await check.text()
            if (check === 'healthcheck') {
                resolve('OK')
            } else {
                reject('WRONG RESPONSE')
            }
        } catch (error) {
            reject('ERROR')
        }
    })
}

const checkLoop = async () => {    
    log('- Healthcheck report:')
    runningInstances.forEach(async(instance, index) => {
        let ip = instance.PublicIpAddress
        try {
            let instanceStatus = await checkHealth(ip)
            runningInstances[index]['health'] = instanceStatus
            log('-->', ip, ':', instance.InstanceId, '-', instanceStatus)
        } catch(err) {
            runningInstances[index]['health'] = 'REPLACING'
            log('-->', ip, ':', instance.InstanceId, '-', err, 'status:', instance.health)
            message({
                type: 'REPLACE',
                payload: instance.InstanceId
            })
        }
    })
}

process.on('message', (data) => {
    switch(data.type) {
        case 'INIT':
            runningInstances = data.payload.runningInstances.map((ri) => ({...ri, health: 'OK'}))
            remotePort = data.payload.remotePort
            instanceAmount = data.payload.instanceAmount
            log('Healthcheck service running!',
                '\ninstanceAmount:', instanceAmount,
                '\nremotePort:', remotePort
            )
            checkInterval = setInterval(checkLoop, 10000)
            break
        
        case 'UPDATE':
            clearInterval(checkInterval)
            log('Received update from Load Balancer!')
            runningInstances = data.payload.runningInstances.map((ri) => ({...ri, health: 'OK'}))
            checkInterval = setInterval(checkLoop, 10000)
            break

        default:
            log('Unrecognized message!')
    }   
})
