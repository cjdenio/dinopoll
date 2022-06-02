import { Poll, PollOption, PrismaClient, Vote } from "@prisma/client";

export type PollOptionWithVotes = PollOption & { votes: Vote[] };

export type PollWithOptions = Poll & {
  options: PollOptionWithVotes[];
  _count: { votes: number };
};

export const prisma = new PrismaClient();
