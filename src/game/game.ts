import { db } from '../db/inmemory';
import { v4 as uuidv4 } from 'uuid';

type Position = { x: number; y: number };
type Ship = { position: Position; direction: boolean; length: number; type?: string };
type Player = {
    id: string;
    ws: WebSocket;
    ships: Ship[];
    board: number[][];
    hits: Position[];
};
type Game = {
    id: string;
    players: Player[];
    currentPlayer: string | null;
    finished?: boolean;
};

function emptyBoard(): number[][] {
    return Array(10)
        .fill(0)
        .map(() => Array(10).fill(0));
}

export function getShipCells(ship: Ship): Position[] {
    const cells: Position[] = [];
    for (let i = 0; i < ship.length; i++) {
        let x = ship.position.x + (ship.direction ? 0 : i);
        let y = ship.position.y + (ship.direction ? i : 0);
        cells.push({ x, y });
    }
    return cells;
}

export function createGame(users: { ws: WebSocket; index: string }[]): Game {
    const game: Game = {
        id: uuidv4(),
        players: users.map((u) => ({
            id: u.index,
            ws: u.ws,
            ships: [],
            board: emptyBoard(),
            hits: [],
        })),
        currentPlayer: null,
    };

    db.games.push(game);

    return game;
}

export function getGameById(gameId: string): Game | undefined {
    return db.games.find((g) => g.id === gameId);
}

export function addPlayerShips(game: Game, playerId: string, ships: Ship[]): void {
    const player = game.players.find((p) => p.id === playerId);

    if (!player) return;

    if (!player.board) {
        player.board = emptyBoard();
    }

    player.ships = ships;

    ships.forEach((ship) => {
        for (const cell of getShipCells(ship)) {
            player.board[cell.y][cell.x] = 1;
        }
    });
}

function getOpponent(game: Game, playerId: string): Player | undefined {
    return game.players.find((p) => p.id !== playerId);
}

function isShipKilled(board: number[][], ships: Ship[], x: number, y: number): Ship | null {
    for (const ship of ships) {
        for (const cell of getShipCells(ship)) {
            if (cell.x === x && cell.y === y) {
                let killed = true;
                for (const pos of getShipCells(ship)) {
                    if (board[pos.y][pos.x] !== 2) killed = false;
                }
                return killed ? ship : null;
            }
        }
    }
    return null;
}

function markKilledArea(board: number[][], ship: Ship): Position[] {
    const marked: Position[] = [];
    for (const cell of getShipCells(ship)) {
        let sx = cell.x;
        let sy = cell.y;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                let tx = sx + dx;
                let ty = sy + dy;

                if (tx >= 0 && tx < 10 && ty >= 0 && ty < 10) {
                    if (board[ty][tx] === 0) {
                        board[ty][tx] = 3;
                        marked.push({ x: tx, y: ty });
                    }
                }
            }
        }
    }
    return marked;
}

export function handleAttack(
    game: Game,
    playerId: string,
    x: number,
    y: number,
): {
    status: string;
    winPlayer?: string;
    killedArea?: Position[];
} {
    const player = game.players.find((p) => p.id === playerId);
    const opponent = game.players.find((p) => p.id !== playerId);

    if (!opponent || !player) {
        return { status: 'miss' };
    }

    if (!opponent.board) {
        opponent.board = emptyBoard();
    }

    if (opponent.board[y][x] === 2) {
        return { status: 'shot' };
    }

    if (opponent.board[y][x] === 3) {
        game.currentPlayer = opponent.id;
        return { status: 'miss' };
    }

    if (opponent.board[y][x] === 1) {
        opponent.board[y][x] = 2;
        const killedShip = isShipKilled(opponent.board, opponent.ships, x, y);

        if (killedShip) {
            for (const cell of getShipCells(killedShip)) {
                opponent.board[cell.y][cell.x] = 2;
            }
            const killedArea = markKilledArea(opponent.board, killedShip);
            const allKilled = opponent.ships.every((ship) => {
                return getShipCells(ship).every((cell) => opponent.board[cell.y][cell.x] === 2);
            });

            if (allKilled) {
                game.finished = true;
                return { status: 'killed', winPlayer: playerId, killedArea };
            }

            return { status: 'killed', killedArea };
        }

        return { status: 'shot' };
    } else {
        opponent.board[y][x] = 3;
        game.currentPlayer = opponent.id;
        return { status: 'miss' };
    }
}

export function handleRandomAttack(
    game: Game,
    playerId: string,
): {
    winPlayer: any;
    status: string;
    position?: Position;
    killedArea?: Position[];
} {
    if (game.currentPlayer !== playerId) return { status: 'miss', winPlayer: undefined };

    const opponent = getOpponent(game, playerId);

    if (!opponent) return { status: 'miss', winPlayer: undefined };

    let cells: Position[] = [];
    for (let y = 0; y < 10; y++)
        for (let x = 0; x < 10; x++)
            if (opponent.board[y][x] === 0 || opponent.board[y][x] === 1) cells.push({ x, y });

    if (cells.length === 0) return { status: 'miss', winPlayer: undefined };

    const idx = Math.floor(Math.random() * cells.length);
    const { x, y } = cells[idx];
    const attackResult = handleAttack(game, playerId, x, y);

    return {
        status: attackResult.status,
        winPlayer: attackResult.winPlayer ?? undefined,
        position: { x, y },
        ...(attackResult.killedArea ? { killedArea: attackResult.killedArea } : {}),
    };
}
