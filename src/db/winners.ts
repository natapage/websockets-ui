import { db } from './inmemory';

type User = {
    name: string;
    wins: number;
    index: string;
};

export function getWinnersTable(): { name: string; wins: number }[] {
    return db.users
        .filter((u: User) => u.wins > 0)
        .sort((a: User, b: User) => b.wins - a.wins)
        .slice(0, 10)
        .map((u: User) => ({ name: u.name, wins: u.wins }));
}

export function updateWinnersTable(winnerId: string): void {
    const user = db.users.find((u: User) => u.index === winnerId);

    if (user) user.wins = (user.wins || 0) + 1;
}
