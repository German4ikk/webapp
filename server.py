import asyncio
import websockets
import json

clients = {}  # Хранит подключённых пользователей
roulette_queue = []  # Очередь для рулетки

async def handler(websocket, path):
    user_id = None
    try:
        async for message in websocket:
            data = json.loads(message)
            if data['type'] == 'register':
                user_id = data['user_id']
                clients[user_id] = websocket
                await websocket.send(json.dumps({'type': 'connected'}))
            elif data['type'] == 'start_stream':
                user_id = data['user_id']
                await websocket.send(json.dumps({'type': 'stream_started', 'user_id': user_id}))
                # Уведомляем всех пользователей о стриме
                for uid, client in clients.items():
                    if uid != user_id:
                        await client.send(json.dumps({'type': 'stream_notification', 'user_id': user_id, 'mode': 'stream'}))
            elif data['type'] == 'join_roulette':
                user_id = data['user_id']
                if roulette_queue and roulette_queue[0] != user_id:
                    partner_id = roulette_queue.pop(0)
                    await clients[user_id].send(json.dumps({'type': 'partner', 'partner_id': partner_id}))
                    await clients[partner_id].send(json.dumps({'type': 'partner', 'partner_id': user_id}))
                else:
                    if user_id not in roulette_queue:
                        roulette_queue.append(user_id)
            elif data['type'] in ['offer', 'answer', 'candidate']:
                to_id = data['to']
                if to_id in clients:
                    await clients[to_id].send(json.dumps(data))
            elif data['type'] == 'chat_message':
                user_id = data['user_id']
                message = data['message']
                # Отправляем сообщение партнёру (для рулетки или стрима)
                if user_id in clients:
                    for uid, client in clients.items():
                        if uid != user_id and (mode == 'roulette' or mode == 'stream'):
                            await client.send(json.dumps({'type': 'chat_message', 'user_id': user_id, 'message': message}))
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if user_id in clients:
            del clients[user_id]
        if user_id in roulette_queue:
            roulette_queue.remove(user_id)

start_server = websockets.serve(handler, "0.0.0.0", 5000)
asyncio.get_event_loop().run_until_complete(start_server)
asyncio.get_event_loop().run_forever()
