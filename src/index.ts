import { App, BlockAction, BlockElementAction, Option } from "@slack/bolt";

import "reflect-metadata";
import { createConnection } from "typeorm";

import createPollModal from "./modal";

import Vote from "./models/Vote";
import Poll from "./models/Poll";
import PollOption from "./models/PollOption";
import message from "./message";

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_TOKEN,
});

app.command("/dinopoll", async ({ client, ack, command }) => {
  await client.views.open({
    trigger_id: command.trigger_id,
    view: createPollModal(command.channel_id, command.text),
  });

  await ack();
});

app.view("create", async ({ ack, payload, body, view, client }) => {
  await ack();
  const values = view.state.values;

  const opts = [
    values.option1.option1.value,
    values.option2.option2.value,
    values.option3.option3.value,
    values.option4.option4.value,
  ].filter((i) => i && i != "");

  const options = opts.map((opt) => {
    const option = new PollOption();

    option.name = opt;
    option.votes = [];

    return option;
  });

  let poll = new Poll();

  poll.createdBy = body.user.id;
  poll.title = values.title.title.value;
  poll.options = options;
  poll.anonymous = values.options.options.selected_options.some(
    (v: Option) => v.value == "anonymous"
  );
  poll.channel = JSON.parse(view.private_metadata).channel;

  poll = await poll.save();

  const resp = await client.chat.postMessage({
    blocks: message(await getPoll(poll.id)),
    text: "This message can't be displayed in your client.",
    channel: JSON.parse(view.private_metadata).channel,
  });

  poll.timestamp = (resp.message as { ts: string }).ts;

  await poll.save();

  await client.chat.postEphemeral({
    text: `Poll successfully created! Run \`/dinopoll-toggle ${poll.id}\` to close the poll once you're done.`,
    channel: JSON.parse(view.private_metadata).channel,
    user: body.user.id,
  });
});

app.command("/dinopoll-toggle", async ({ ack, command }) => {
  try {
    // Find poll
    const poll = await Poll.findOneOrFail({
      id: parseInt(command.text),
      createdBy: command.user_id,
    });

    poll.open = !poll.open;

    await poll.save();

    await refreshPoll(poll.id);

    await ack("success!");
  } catch (e) {
    await ack("something went wrong :cry:");
  }
});

app.action(/vote:(.+):(.+)/, async ({ action, ack, payload, body }) => {
  await ack();

  const action_id = (action as BlockElementAction).action_id;
  const matches = action_id.match(/vote:(.+):(.+)/);
  if (!matches) {
    return;
  }

  const [, poll_id, option_id] = matches;

  let poll = await Poll.findOne(parseInt(poll_id), {
    relations: ["options"],
  });

  if (!poll || !poll.open) {
    return;
  }

  // Check to see if the user's already voted
  const userVote = await Vote.findOne(
    {
      user: body.user.id,
      poll: { id: parseInt(poll_id) },
    },
    { relations: ["option"] }
  );
  if (userVote) {
    // They've already voted
    await userVote.remove();

    // Are they voting for the same option? if so, don't switch their vote
    if (userVote.option.id == parseInt(option_id)) {
      await refreshPoll(parseInt(poll_id));
      return;
    }
  }

  const option = await PollOption.findOneOrFail(parseInt(option_id));

  // Create a vote
  const vote = new Vote();

  vote.user = body.user.id;
  vote.option = option;
  vote.poll = poll;

  await vote.save();

  // Re-fetch the poll

  await refreshPoll(parseInt(poll_id));
});

async function getPoll(pollId: number): Promise<Poll> {
  return await Poll.createQueryBuilder("poll")
    .leftJoinAndSelect("poll.options", "option")
    .leftJoinAndSelect("option.votes", "option.vote")
    .leftJoinAndSelect("poll.votes", "vote")
    .where("poll.id = :id", { id: pollId })
    .orderBy("option.id", "ASC")
    .getOneOrFail();
}

async function refreshPoll(pollId: number) {
  const poll = await getPoll(pollId);

  await app.client.chat.update({
    token: process.env.SLACK_TOKEN,
    text: "This message can't be displayed in your client.",
    blocks: message(poll),
    ts: poll.timestamp,
    channel: poll.channel,
  });
}

async function main() {
  await createConnection({
    type: "postgres",
    url: process.env.DATABASE_URL,
    entities: [Poll, PollOption, Vote],
    synchronize: true,
  });

  await app.start(parseInt(process.env.PORT as string) || 3000);
  console.log("App started");
}

main();
