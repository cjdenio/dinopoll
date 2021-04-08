import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  BaseEntity,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import PollOption from "./PollOption";
import Vote from "./Vote";

@Entity()
class Poll extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn()
  createdOn: string;

  @Column({
    nullable: true,
  })
  createdBy: string;

  @Column()
  title: string;

  @OneToMany(() => PollOption, (option) => option.poll, {
    cascade: true,
  })
  options: PollOption[];

  @Column({
    default: false,
  })
  anonymous: boolean;

  @Column({
    default: false,
  })
  multipleVotes: boolean;

  @Column({
    default: false,
  })
  othersCanAdd: boolean;

  @Column({
    default: true,
  })
  open: boolean;

  @Column({
    nullable: true,
  })
  timestamp: string;

  @Column()
  channel: string;

  @OneToMany(() => Vote, (vote) => vote.poll, {
    eager: true,
  })
  votes: Vote[];
}

export default Poll;
