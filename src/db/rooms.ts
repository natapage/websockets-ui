import { db } from './inmemory';
import { v4 as uuidv4 } from 'uuid';

type User = {
    name: string;
    password: string;
    index: string;
    wins: number;
    ws: any;
};

type Room = {
    id: string;
    users: User[];
};

export function createRoom(user: User): Room {
    const room: Room = {
        id: uuidv4(),
        users: [user],
    };
    db.rooms.push(room);
    return room;
}

export function joinRoom(roomId: string, user: User): Room | null {
    const room = db.rooms.find((r) => r.id === roomId);

    if (room && room.users.length < 2) {
        room.users.push(user);
        return room;
    }
    return null;
}

export function removeRoom(roomId: string): void {
    db.rooms = db.rooms.filter((r) => r.id !== roomId);
}

export function getRooms(): { roomId: string; roomUsers: { name: string; index: string }[] }[] {
    return db.rooms
        .filter((r) => r.users.length === 1)
        .map((r) => ({
            roomId: r.id,
            roomUsers: r.users.map((u) => ({ name: u.name, index: u.index })),
        }));
}

export function getRoomById(roomId: string): Room | undefined {
    return db.rooms.find((r) => r.id === roomId);
}
