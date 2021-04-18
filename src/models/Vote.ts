import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  BaseEntity,
  CreateDateColumn,
  ManyToOne,
} from "typeorm";
import Poll from "./Poll";
import PollOption from "./PollOption";

@Entity()
class Vote extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn()
  createdOn: string;

  @Column()
  user: string;

  @ManyToOne(() => PollOption, (option) => option.votes)
  option: PollOption;

  @ManyToOne(() => Poll, (poll) => poll.votes)
  poll: Poll;
}

export default Vote;
