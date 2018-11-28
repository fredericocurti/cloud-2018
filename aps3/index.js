// @ts-check
const aws = require('aws-sdk')
const fs = require('fs')
const { spawnSync } = require('child_process')
const path = require('path')
const http = require('http')
aws.config.update({ region: 'us-east-1' })
const ec2 = new aws.EC2()
const fetch = require('node-fetch')

const remotePort = 5000


class InstanceManager {
    constructor(keyPairName, securityGroupName, ownerName) {
        // @ts-ignore
        return (async () => {

            // let [keyPair, securityGroup] = await Promise.all([
            // this.createKeyPair(keyPairName), this.createSecurityGroup(securityGroupName)
            // ])
            console.log('--- building InstanceManager ---\n')

            console.log('-> Trying to create KeyPair', keyPairName)
            this.keyPair = await this.createKeyPair(keyPairName)

            console.log('\n-> Trying to create security group', securityGroupName)
            try {
                this.securityGroup = await this.createSecurityGroup(securityGroupName)    
            } catch (error) {
                throw error
            }
            
            this.ownerName = ownerName
            this.securityGroupName = securityGroupName
            this.instances = []
            await this.updateInstancesArray()

            console.log('\n~~> InstanceManager created successfully <~~')
            return this; // when done
        })()
    }

    async deleteKeyPair(keyName) {
        console.log('deleting key', keyName)
        try {
            return await ec2.deleteKeyPair({ KeyName: keyName }).promise()
        } catch (error) {
            throw error
        }
    }

    async deleteSecurityGroup(securityGroupName) {
        console.log('deleting security group', securityGroupName)
        try {
            return await ec2.deleteSecurityGroup({ GroupName: securityGroupName }).promise()
        } catch (error) {
            throw error
        }
    }

    async createKeyPair(keyName) {
        let keyPairs = await ec2.describeKeyPairs().promise()
        let found = keyPairs.KeyPairs.find((el) => el.KeyName === keyName)

        if (found) {
            console.log(`[WARNING] KEYPAIR ${keyName} ALREADY EXISTS! USING THE CURRENT ONE`)
            return found
        } else {
            try {
                fs.unlinkSync(path.join(__dirname,`${keyName}.pem`))
            } catch (error) {
                console.log('Failed deleting existing key on file system')
            }
            console.log('Creating new key with name', keyName)
            try {
                let res = await ec2.createKeyPair({ KeyName: 'fred-aps3' }).promise()
                fs.writeFileSync(`./${keyName}.pem`, res.KeyMaterial)
                console.log(`Key created! - file is ./${keyName}.pem \n`)
                return res
            } catch (error) {
                throw error
            }
        }
    }

    async createSecurityGroup(groupName) {
        try {
            let sg = await ec2.createSecurityGroup({
                GroupName: groupName,
                Description: groupName,
            }).promise()
            console.log('New Group created! -', sg.GroupId, '\n')
            console.log('Allowing ports 22 and 5000 on SG')
            try {
                let res = await ec2.authorizeSecurityGroupIngress({
                    GroupId: sg.GroupId,
                    IpPermissions: [
                        { FromPort: 22, IpProtocol: 'tcp', ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
                        { FromPort: 5000, IpProtocol: 'tcp', ToPort: 5000, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }
                    ]
                }).promise()
            } catch (err) {
                throw err
            }
            return sg
        } catch (error) {
            if (error.code === 'InvalidGroup.Duplicate') {
                console.log('Group already exists, attempting to delete...')
                try {
                    let res = await ec2.deleteSecurityGroup({ GroupName: groupName }).promise()
                    console.log('Group deleted successfully!')
                } catch (err) {
                    if (err.code === 'DependencyViolation') {
                        console.log("[WARNING] THERE ARE RUNNING INSTANCES THAT USE THIS SECURITY GROUP. IT WON'T BE DELETED")
                        console.log('[WARNING] RUN checkAndTerminateRunningInstances TO CREATE A NEW SECURITY GROUP')
                        console.log('[WARNING] THE SECURITY GROUP FOR THIS MANAGER WILL BE THE EXISTING ONE')
                        let sg = await ec2.describeSecurityGroups(({ GroupNames: [groupName] })).promise()
                        return sg.SecurityGroups[0]
                    } else {
                        throw err
                    }
                }
                return this.createSecurityGroup(groupName)
            }
        }
    }

    async createInstances(instanceAmount) {
        return new Promise(async (resolve, reject) => {
            console.log('\n-> Creating', instanceAmount, 'instance(s)')
            console.log(`KeyPair: ${this.keyPair.KeyName}`)
            console.log(`SecurityGroup: ${this.securityGroupName}`)
            // Ubuntu Server 18 AMI ID
            const imageId = 'ami-0ac019f4fcb7cb7e6'
            console.log('UserData:', path.join(__dirname,'install.sh'))
            const userDataFile = fs.readFileSync(path.join(__dirname,'install.sh')).toString()
    
            let res = await ec2.runInstances({
                TagSpecifications: [{ Tags: [{ Key: 'Owner', Value: this.ownerName }], ResourceType: 'instance' }],
                SecurityGroupIds: [this.securityGroup.GroupId],
                MaxCount: instanceAmount,
                MinCount: instanceAmount,
                InstanceType: 't2.micro',
                ImageId: imageId,
                KeyName: this.keyPair.KeyName,
                UserData: Buffer.from(userDataFile).toString('base64'),
            }).promise()

            let ready = {}
            let newInstancesIds = res.Instances.map((i) => {
                ready[i.InstanceId] = false    
                return i.InstanceId
            })
            
            // Check if instances are running
            let checkInterval = setInterval(async () => {
                let status = await ec2.describeInstances(({
                    InstanceIds: newInstancesIds
                })).promise()

                console.log('Waiting for new instances to be running...')
                status.Reservations.forEach(r => {
                    r.Instances.forEach(async(i) => {
                        try {
                            // @ts-ignore
                            let s = await fetch(`http://${i.PublicIpAddress}:${remotePort}/healthcheck`)    
                            if (s.status === 200) {
                                ready[i.InstanceId] = true
                            } else {
                                ready[i.InstanceId] = i.State.Name
                            }
                        } catch (error) {
                            ready[i.InstanceId] = error.message
                        }
                    }) 
                })

                console.log(ready)
                
                let allRunning = Object.values(ready).every((i) => i === true)
                if (allRunning) {
                    clearInterval(checkInterval)
                    console.log('All new instances are running and healthchecked!')
                    this.updateInstancesArray()
                    resolve(res)
                }
            }, 5000)
        })
    }

    async purge() {
        console.log('\n-> Purging')
        try {
            await this.checkAndTerminateRunningInstances()
            await Promise.all([
                this.deleteKeyPair(this.keyPair.KeyName),
                this.deleteSecurityGroup(this.securityGroupName)
            ])
        } catch (error) {
            throw error
        }

        console.log('Purge successfull, please instantiate other InstanceManager')
    }

    async _waitInstancesTermination(instanceIds) {
        return new Promise((resolve, reject) => {
            let waiting = 'Waiting...'
            const interval = setInterval(async () => {
                try {
                    let terminationResult = await ec2.terminateInstances({
                        InstanceIds: instanceIds
                    }).promise()
                    // process.stdout.write('\x033c')
                    console.log(waiting)
                    waiting = waiting.concat('.')
                    terminationResult.TerminatingInstances.forEach((ti) => {
                        console.log(' - ', ti.InstanceId, ':', ti.CurrentState.Name)
                    })

                    let allDone = terminationResult.TerminatingInstances
                        .every(i => i.CurrentState.Name === 'terminated')

                    if (allDone) {
                        console.log('Instances finished terminating!')
                        clearInterval(interval)
                        resolve(terminationResult)
                    }

                } catch (error) {
                    reject(error)
                }

            }, 10000)
        })
    }

    async updateInstancesArray() {
        let instancesWithSameTag = await ec2.describeInstances({
            Filters: [
                { Name: 'tag:Owner', Values: [this.ownerName] }
            ]
        }).promise()

        this.instances = instancesWithSameTag.Reservations.reduce((acc, r) => {
            r.Instances.forEach(i => {
                if (i.State.Name !== 'terminated') acc.push(i)
            })
            return acc
        }, [])
    }

    async terminateInstance(instanceId) {
        console.log('Terminating instance', instanceId)
        try {
            let terminationResult = await this._waitInstancesTermination([instanceId])
            return terminationResult
        } catch (error) {
            throw error
        }
    }

    async checkAndTerminateRunningInstances() {
        console.log('\n-> Terminating all instances with tag Owner:' + this.ownerName)
        let instancesWithSameTag = await ec2.describeInstances({
            Filters: [
                { Name: 'tag:Owner', Values: [this.ownerName] }
            ]
        }).promise()

        if (instancesWithSameTag.Reservations.length > 0) {
            console.log(
                `There are ${instancesWithSameTag.Reservations.length} instances with the tag Owner:${this.ownerName}\n` +
                'Please wait for them to be terminated...'
            )

            let terminationInstanceIds = instancesWithSameTag.Reservations.reduce((acc, r) => {
                r.Instances.forEach(i => {
                    if (i.State.Name !== 'terminated') acc.push(i.InstanceId)
                    else console.log('Instance', i.InstanceId, 'is already terminated')
                })
                return acc
            }, [])

            if (terminationInstanceIds.length > 0) {
                try {
                    let terminationResult = await this._waitInstancesTermination(terminationInstanceIds)

                    return terminationResult
                } catch (error) {
                    throw error
                }
            }
        } else {
            return true
        }
    }
}

// const main = async () => {
//     const instanceManager = await new InstanceManager('fred-aps3', 'APS-fred', 'fredericocurti')
// //     await instanceManager.checkAndTerminateRunningInstances()
// //     await instanceManager.createInstances(1)
// // instance
// }

// main()

module.exports = {
    InstanceManager
}