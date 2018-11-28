from flask import Flask, redirect, url_for, request
from pymongo import MongoClient
import json
import bson

app = Flask(__name__)

global tasks, tasks_count
tasks = {}
tasks_count = 0

def Task(id, content):
    return {'_id': str(id), 'content': content}

client = MongoClient('mongodb://cloud2018:cloud2018@ds119394.mlab.com:19394/cloudproj')
db = client['cloudproj']
tasks = db['tasks']

@app.route('/')
def front():
    return 'welcome'

@app.route('/task', methods = ['POST', 'GET'])
def get_all_or_add():
    global tasks_count

    if request.method == 'POST':
        body = json.loads(request.data)

        task_id = str(bson.ObjectId())
        r = tasks.insert_one(Task(task_id, body['content']))

        return json.dumps({'status': 200, 'id': task_id}), 200
    else:
        # tasks.find
        return json.dumps(list(tasks.find()))


@app.route('/task/<id>', methods = ['DELETE', 'GET', 'PUT'])
def alter(id):
    if request.method == 'DELETE':
        try:
            # del tasks[id]
            result = tasks.delete_one({'_id': id})

            if (result.deleted_count == 0):
                raise Exception

            return json.dumps({'status': 200, 'message':'content deleted'}), 200
        except:
            return json.dumps({'status': 404, 'message':'task not found'}), 404

    elif request.method == 'PUT':
        body = json.loads(request.data)
        print(id, body)
        try:
            if tasks.update_one({'_id': id}, {"$set": {"content": body['content']}}).modified_count == 0:
                raise Exception
            return json.dumps({'status': 200, 'message':'content updated'}), 200
        except:
            return json.dumps({'status': 404, 'message':'task not found'}), 404
    else:
        try:
            return json.dumps(dict(tasks.find_one({'_id': id}))), 200
        except:
            return json.dumps({'status': 404, 'message': 'task not found'}), 404

    
@app.route('/healthcheck', methods = ['GET'])
def healthcheck():
    return 'healthcheck', 200

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)