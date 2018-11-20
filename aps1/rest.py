from flask import Flask, redirect, url_for, request
import json
app = Flask(__name__)

global tasks, tasks_count
tasks = {}
tasks_count = 0

class Task():
    def __init__(self, id, content):
        self.id = id
        self.content = content

@app.route('/')
def front():
    return 'welcome'

@app.route('/task', methods = ['POST', 'GET'])
def get_all_or_add():
    global tasks_count

    if request.method == 'POST':
        body = json.loads(request.data)
        tasks[tasks_count] = Task(tasks_count, body['content'])
        tasks_count += 1
        return json.dumps({'status': 200}), 200
    else:
        return json.dumps(tasks, default=lambda x: x.__dict__)


@app.route('/task/<int:id>', methods = ['DELETE', 'GET', 'PUT'])
def alter(id):
    if request.method == 'DELETE':
        try:
            del tasks[id]
            return json.dumps({'status': 200, 'message':'content deleted'}), 200
        except:
            return json.dumps({'status': 404, 'message':'task not found'}), 404

    elif request.method == 'PUT':
        body = json.loads(request.data)
        print(id, body)
        try:
            tasks[id].content = body['content']
            return json.dumps({'status': 200, 'message':'content updated'}), 200
        except:
            return json.dumps({'status': 404, 'message':'task not found'}), 404
    else:
        try:
            data = tasks[id]
            return json.dumps(data, default=lambda x: x.__dict__), 200
        except:
            return json.dumps({'status': 404}), 404

    
@app.route('/healthcheck', methods = ['GET'])
def healthcheck():
    return 'healthcheck', 200

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)