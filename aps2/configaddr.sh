#!/bin/sh

Yellow='\033[0;33m'       # Yellow

configfn() {
    export SERVER_PATH=$1
    echo "Exported SERVER_PATH=${1}"
}

wd=`pwd`

echo "Make sure you run this like $ source ./configaddr.sh"
tput setaf 3;
echo "Please add the following line to your .bashrc or equivalent"
echo "export PATH=${wd}:\$PATH\"\b "
tput sgr0;
# \"rab\"


read "?Type server path and press [ENTER] (http://...): " X
configfn $X
