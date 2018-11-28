#!/bin/bash
sudo apt -y update
sudo apt -y install python3-pip
/usr/bin/pip3 install flask

git clone https://github.com/fredericocurti/cloud-2018 /home/ubuntu/cloud-2018
python3 /home/ubuntu/cloud-2018/aps1/rest.py