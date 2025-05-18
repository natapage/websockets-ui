import { db } from '../db/inmemory';
import { v4 as uuidv4 } from 'uuid';
import { getWinnersTable, updateWinnersTable } from '../db/winners';
import { createRoom, joinRoom, getRooms, removeRoom } from '../db/rooms';
import { addPlayerShips, handleAttack, handleRandomAttack, getGameById } from '../game/game';

const BOT_NAME = 'Bot';
const BOT_PASSWORD = 'bot_secret';

function send(ws: any, msg: any): void {
    const safeMsg = {
        ...msg,
        data: typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data ?? ''),
    };
    ws.send(JSON.stringify(safeMsg));
}

function broadcastAll(wss: any, msg: any): void {
    let safeMsg = { ...msg };

    if (safeMsg.type === 'update_room' && !Array.isArray(safeMsg.data)) {
        safeMsg.data = [];
    }

    safeMsg.data = JSON.stringify(safeMsg.data ?? '');
    wss.clients.forEach((client: any) => {
        if (client.readyState === 1) client.send(JSON.stringify(safeMsg));
    });
}

function logUpdateWinners() {
    const winners = getWinnersTable();
    const msg = {
        type: 'update_winners',
        data: Array.isArray(winners)
            ? winners.map((w: any) => ({
                  name: w.name,
                  wins: w.wins,
              }))
            : [],
        id: 0,
    };
    console.log(msg);
}

type Ship = {
    position: { x: number; y: number };
    direction: boolean;
    length: number;
    type: string;
};

function generateRandomShips(): Ship[] {
    const ships: Ship[] = [];
    const board = Array(10)
        .fill(0)
        .map(() => Array(10).fill(0));
    const shipConfigs = [
        { type: 'huge', length: 4, count: 1 },
        { type: 'large', length: 3, count: 2 },
        { type: 'medium', length: 2, count: 3 },
        { type: 'small', length: 1, count: 4 },
    ];

    function canPlace(x: number, y: number, len: number, dir: boolean) {
        for (let i = 0; i < len; i++) {
            let nx = x + (dir ? 0 : i);
            let ny = y + (dir ? i : 0);

            if (nx < 0 || ny < 0 || nx >= 10 || ny >= 10) return false;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    let tx = nx + dx;
                    let ty = ny + dy;

                    if (tx >= 0 && tx < 10 && ty >= 0 && ty < 10) {
                        if (board[ty][tx] === 1) return false;
                    }
                }
            }
        }
        return true;
    }

    function placeShip(len: number, type: string) {
        let placed = false;
        let tries = 0;

        while (!placed && tries < 100) {
            const dir = Math.random() < 0.5;
            const x = Math.floor(Math.random() * (dir ? 10 : 11 - len));
            const y = Math.floor(Math.random() * (dir ? 11 - len : 10));

            if (canPlace(x, y, len, dir)) {
                for (let i = 0; i < len; i++) {
                    let nx = x + (dir ? 0 : i);
                    let ny = y + (dir ? i : 0);
                    board[ny][nx] = 1;
                }
                ships.push({ position: { x, y }, direction: dir, length: len, type });
                placed = true;
            }
            tries++;
        }
    }

    for (const cfg of shipConfigs) {
        for (let i = 0; i < cfg.count; i++) {
            placeShip(cfg.length, cfg.type);
        }
    }

    return ships;
}

export function handleWSConnection(ws: any, wss: any): void {
    ws.on('message', async (message: string) => {
        let req: any;

        try {
            req = JSON.parse(message);
        } catch (err) {
            console.error('Failed to parse incoming message:', err);
            return;
        }

        let { type, data } = req;

        if (typeof data === 'string' && data.trim() !== '') {
            try {
                data = JSON.parse(data);
            } catch (err) {
                console.error('Failed to parse data field:', err);
            }
        }

        let res = { type, data: {}, id: 0 };

        console.log('Received:', req);

        switch (type) {
            case 'reg': {
                const { name, password } = data;

                let user = db.users.find((u: any) => u.name === name);

                if (!user) {
                    user = { name, password, index: uuidv4(), wins: 0, ws };
                    db.users.push(user);
                    res.data = { name, index: user.index, error: false, errorText: '' };
                } else if (user.password !== password) {
                    res.data = { name, index: -1, error: true, errorText: 'Wrong password' };
                } else {
                    user.ws = ws;
                    res.data = { name, index: user.index, error: false, errorText: '' };
                }

                send(ws, res);

                broadcastAll(wss, { type: 'update_room', data: getRooms(), id: 0 });

                broadcastAll(wss, { type: 'update_winners', data: getWinnersTable(), id: 0 });
                logUpdateWinners();

                break;
            }

            case 'create_room': {
                const user = db.users.find((u: any) => u.ws === ws);

                if (!user) break;

                createRoom(user);

                broadcastAll(wss, { type: 'update_room', data: getRooms(), id: 0 });

                break;
            }

            case 'add_user_to_room': {
                const user = db.users.find((u: any) => u.ws === ws);

                if (!user) break;

                const { indexRoom } = data;
                const room = joinRoom(indexRoom, user);

                if (!room) break;

                if (room.users.length === 2) {
                    const game = {
                        id: uuidv4(),
                        players: room.users.map((u: any) => ({
                            id: u.index,
                            ws: u.ws,
                            ships: [],
                            isBot: !!u.isBot,
                            board: Array(10)
                                .fill(0)
                                .map(() => Array(10).fill(0)),
                            hits: [],
                        })),
                        currentPlayer: room.users[0].index,
                        finished: false,
                    };
                    db.games.push(game);
                    room.users.forEach((u: any, idx: number) => {
                        if (!u || !u.ws) return;
                        send(u.ws, {
                            type: 'create_game',
                            data: { idGame: game.id, idPlayer: game.players[idx].id },
                            id: 0,
                        });
                    });

                    removeRoom(room.id);
                }

                broadcastAll(wss, { type: 'update_room', data: getRooms(), id: 0 });

                break;
            }

            case 'add_ships': {
                const { gameId, ships, indexPlayer } = data;

                const game = getGameById(gameId);

                if (!game) break;

                addPlayerShips(game, indexPlayer, ships);

                const isSingle = game.players.some((p: any) => p.isBot);

                if (isSingle && game.players.every((p: any) => p.ships && p.ships.length > 0)) {
                    const realPlayer = game.players.find((p: any) => !p.isBot);

                    if (!realPlayer) break;

                    game.currentPlayer = realPlayer.id;

                    send(realPlayer.ws, {
                        type: 'start_game',
                        data: {
                            ships: realPlayer.ships,
                            currentPlayerIndex: game.currentPlayer,
                        },
                        id: 0,
                    });

                    send(realPlayer.ws, {
                        type: 'turn',
                        data: { currentPlayer: game.currentPlayer },
                        id: 0,
                    });
                } else if (!isSingle && game.players.every((p: any) => p.ships.length > 0)) {
                    game.currentPlayer = game.players[0].id;

                    game.players.forEach((p: any) => {
                        if (!p || !p.ws) return;

                        send(p.ws, {
                            type: 'start_game',
                            data: {
                                ships: p.ships,
                                currentPlayerIndex: game.currentPlayer,
                            },
                            id: 0,
                        });

                        send(p.ws, {
                            type: 'turn',
                            data: { currentPlayer: game.currentPlayer },
                            id: 0,
                        });
                    });
                }

                break;
            }

            case 'attack': {
                const { gameId, x, y, indexPlayer } = data;

                const game = getGameById(gameId);

                if (!game) break;

                if (game.currentPlayer !== indexPlayer) break;

                const result = handleAttack(game, indexPlayer, x, y);

                const isSingle = game.players.some((p: any) => p.isBot);

                const sendAttackMsg = (
                    wsTarget: any,
                    pos: { x: number; y: number },
                    status: string,
                ) => {
                    send(wsTarget, {
                        type: 'attack',
                        data: {
                            position: pos,
                            currentPlayer: indexPlayer,
                            status,
                        },
                        id: 0,
                    });
                };

                if (isSingle) {
                    const realPlayer = game.players.find((p: any) => !p.isBot);
                    const bot = game.players.find((p: any) => p.isBot);

                    if (!realPlayer || !bot) break;

                    sendAttackMsg(realPlayer.ws, { x, y }, result.status);

                    if (result.status === 'killed' && result.killedArea) {
                        for (const cell of result.killedArea) {
                            sendAttackMsg(realPlayer.ws, cell, 'miss');
                        }
                    }

                    if (result.winPlayer) {
                        send(realPlayer.ws, {
                            type: 'finish',
                            data: { winPlayer: result.winPlayer },
                            id: 0,
                        });

                        const winnerUser = db.users.find((u: any) => u.index === result.winPlayer);

                        if (!winnerUser) {
                            console.error('No user found for winPlayer id:', result.winPlayer);
                        } else {
                            const winnerName = winnerUser.name;

                            updateWinnersTable(winnerName);
                        }

                        broadcastAll(wss, {
                            type: 'update_winners',
                            data: getWinnersTable(),
                            id: 0,
                        });
                        logUpdateWinners();

                        break;
                    }

                    if (result.status === 'miss') {
                        send(realPlayer.ws, {
                            type: 'turn',
                            data: { currentPlayer: bot.id },
                            id: 0,
                        });

                        setTimeout(function botMove() {
                            let bx, by;
                            let tries = 0;

                            do {
                                bx = Math.floor(Math.random() * 10);
                                by = Math.floor(Math.random() * 10);
                                tries++;

                                if (tries > 200) break;
                            } while (
                                realPlayer &&
                                realPlayer.board &&
                                (realPlayer.board[by][bx] === 2 || realPlayer.board[by][bx] === 3)
                            );

                            const botResult = handleAttack(game, bot.id, bx, by);

                            if (realPlayer) {
                                sendAttackMsg(realPlayer.ws, { x: bx, y: by }, botResult.status);

                                if (botResult.status === 'killed' && botResult.killedArea) {
                                    for (const cell of botResult.killedArea) {
                                        sendAttackMsg(realPlayer.ws, cell, 'miss');
                                    }
                                }
                            }

                            if (botResult.winPlayer) {
                                if (realPlayer) {
                                    send(realPlayer.ws, {
                                        type: 'finish',
                                        data: { winPlayer: botResult.winPlayer },
                                        id: 0,
                                    });
                                }

                                const winnerUser = db.users.find(
                                    (u: any) => u.index === botResult.winPlayer,
                                );

                                if (!winnerUser) {
                                    console.error(
                                        'No user found for winPlayer id:',
                                        botResult.winPlayer,
                                    );
                                } else {
                                    const winnerName = winnerUser.name;
                                    console.log('Winner name to updateWinnersTable:', winnerName);

                                    updateWinnersTable(winnerName);
                                }

                                broadcastAll(wss, {
                                    type: 'update_winners',
                                    data: getWinnersTable(),
                                    id: 0,
                                });
                                logUpdateWinners();

                                return;
                            }

                            if (botResult.status === 'miss') {
                                if (realPlayer) {
                                    send(realPlayer.ws, {
                                        type: 'turn',
                                        data: { currentPlayer: realPlayer.id },
                                    });
                                }
                            } else {
                                setTimeout(botMove, 700);
                            }
                        }, 700);
                    } else {
                        send(realPlayer.ws, {
                            type: 'turn',
                            data: { currentPlayer: realPlayer.id },
                        });
                    }
                } else {
                    game.players.forEach((p: any) => {
                        if (!p || !p.ws) return;

                        sendAttackMsg(p.ws, { x, y }, result.status);

                        if (result.status === 'killed' && result.killedArea) {
                            for (const cell of result.killedArea) {
                                sendAttackMsg(p.ws, cell, 'miss');
                            }
                        }
                    });

                    if (result.status === 'miss') {
                        game.players.forEach((p: any) => {
                            if (!p || !p.ws) return;

                            send(p.ws, {
                                type: 'turn',
                                data: { currentPlayer: game.currentPlayer },
                                id: 0,
                            });
                        });
                    }

                    if (result.winPlayer) {
                        game.players.forEach((p: any) => {
                            if (!p || !p.ws) return;

                            send(p.ws, {
                                type: 'finish',
                                data: { winPlayer: result.winPlayer },
                                id: 0,
                            });
                        });

                        const winnerUser = db.users.find((u: any) => u.index === result.winPlayer);

                        if (!winnerUser) {
                            console.error('No user found for winPlayer id:', result.winPlayer);
                        } else {
                            const winnerName = winnerUser.name;
                            updateWinnersTable(winnerName);

                            console.log('Winners table after update:', getWinnersTable());
                        }

                        broadcastAll(wss, {
                            type: 'update_winners',
                            data: getWinnersTable(),
                            id: 0,
                        });
                        logUpdateWinners();
                    }
                }

                break;
            }

            case 'randomAttack': {
                const { gameId, indexPlayer } = data;

                const game = getGameById(gameId);

                if (!game) break;

                if (game.currentPlayer !== indexPlayer) break;

                const result = handleRandomAttack(game, indexPlayer);

                game.players.forEach((p: any) => {
                    if (!p || !p.ws) return;

                    send(p.ws, {
                        type: 'attack',
                        data: {
                            position: result.position,
                            currentPlayer: indexPlayer,
                            status: result.status,
                        },
                        id: 0,
                    });

                    if (p.ws === ws)
                        res.data = {
                            position: result.position,
                            currentPlayer: indexPlayer,
                            status: result.status,
                        };

                    if (result.status === 'killed' && result.killedArea) {
                        for (const cell of result.killedArea) {
                            send(p.ws, {
                                type: 'attack',
                                data: {
                                    position: cell,
                                    currentPlayer: indexPlayer,
                                    status: 'miss',
                                },
                                id: 0,
                            });
                        }
                    }
                });

                if (result.status === 'miss') {
                    game.players.forEach((p: any) => {
                        if (!p || !p.ws) return;

                        send(p.ws, {
                            type: 'turn',
                            data: { currentPlayer: game.currentPlayer },
                        });
                    });
                }

                if (result.winPlayer) {
                    game.players.forEach((p: any) => {
                        if (!p || !p.ws) return;

                        send(p.ws, {
                            type: 'finish',
                            data: { winPlayer: result.winPlayer },
                            id: 0,
                        });
                    });

                    const winnerUser = db.users.find((u: any) => u.index === result.winPlayer);

                    if (!winnerUser) {
                        console.error('No user found for winPlayer id:', result.winPlayer);
                    } else {
                        const winnerName = winnerUser.name;
                        updateWinnersTable(winnerName);
                    }

                    broadcastAll(wss, { type: 'update_winners', data: getWinnersTable(), id: 0 });
                    logUpdateWinners();
                }

                break;
            }

            case 'single_play': {
                const roomId = uuidv4();
                const gameId = uuidv4();
                const botId = uuidv4();

                const user = db.users.find((u: any) => u.ws === ws);

                if (!user) break;

                const bot = {
                    name: BOT_NAME,
                    password: BOT_PASSWORD,
                    index: botId,
                    wins: 0,
                    ws: null,
                };

                db.users.push(bot);

                const room = {
                    id: roomId,
                    users: [user, bot],
                    isSingle: true,
                };

                db.rooms.push(room);

                const botShips = generateRandomShips();

                const game = {
                    id: gameId,
                    players: [
                        {
                            id: user.index,
                            ws,
                            ships: [],
                            isBot: false,
                            board: Array(10)
                                .fill(0)
                                .map(() => Array(10).fill(0)),
                            hits: [],
                        },
                        {
                            id: botId,
                            ws: null,
                            ships: [],
                            isBot: true,
                            board: Array(10)
                                .fill(0)
                                .map(() => Array(10).fill(0)),
                            hits: [],
                        },
                    ],
                    currentPlayer: user.index,
                    finished: false,
                };

                db.games.push(game);

                addPlayerShips(game, botId, botShips);

                send(ws, {
                    type: 'create_game',
                    data: { idGame: gameId, idPlayer: user.index },
                    id: 0,
                });

                send(ws, {
                    type: 'update_room',
                    data: getRooms(),
                    id: 0,
                });

                break;
            }
        }

        console.log('Responded:', res);
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });
}
