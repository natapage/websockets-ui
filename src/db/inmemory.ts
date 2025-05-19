type User = {
    name: string;
    password: string;
    index: string;
    wins: number;
    ws: WebSocket | null;
};

type Room = {
    id: string;
    users: User[];
};

type Game = {
    id: string;
    players: any[];
    currentPlayer: string | null;
    finished?: boolean;
};

export const db = {
    users: [] as User[],
    rooms: [] as Room[],
    games: [] as Game[],
    winners: [] as any[],
};
