import {
  App,
  BlockAction,
  BlockElementAction,
  ExpressReceiver,
  Option,
  ViewUpdateResponseAction,
} from "@slack/bolt";

import express from "express";

import "reflect-metadata";
import { createConnection } from "typeorm";

import createPollModal from "./modal";

import Vote from "./models/Vote";
import Poll from "./models/Poll";
import PollOption from "./models/PollOption";
import message from "./message";
import Token from "./models/Token";
import ws from "./workflow_step";

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET as string,
});

receiver.router.post("/create", express.json(), async (req, res) => {
  try {
    const { title, options, channel, othersCanAdd, multipleVotes } = req.body;
    const tok = req.headers.authorization?.slice("Bearer ".length);
    if (!tok) {
      throw new Error("no token provided");
    }

    const token = await Token.findOneOrFail({ token: tok });

    const poll = new Poll();

    poll.title = title;
    poll.options = options.map((i: string) => {
      const option = new PollOption();
      option.name = i;
      return option;
    });
    poll.channel = channel;
    poll.othersCanAdd = othersCanAdd || false;
    poll.multipleVotes = multipleVotes || false;

    poll.createdBy = token.user;

    await createPoll(poll);

    res.json({
      ok: true,
      message: "woop woop you did it",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      err: err.message,
    });
  }
});

const app = new App({
  token: process.env.SLACK_TOKEN,
  receiver,
});

export async function createPoll(poll: Poll): Promise<Poll> {
  poll = await poll.save();

  const resp = await app.client.chat.postMessage({
    blocks: message(await getPoll(poll.id)),
    text: "This message can't be displayed in your client.",
    channel: poll.channel,
    token: process.env.SLACK_TOKEN,
  });

  poll.timestamp = (resp.message as { ts: string }).ts;

  await poll.save();

  if (poll.createdBy) {
    await app.client.chat.postEphemeral({
      text: `Poll successfully created! Run \`/dinopoll-toggle ${poll.id}\` to close the poll once you're done.`,
      channel: poll.channel,
      user: poll.createdBy,
      token: process.env.SLACK_TOKEN,
    });
  }

  return poll;
}

app.step(ws);

app.command("/dinopoll", async ({ client, ack, command }) => {
  await client.views.open({
    trigger_id: command.trigger_id,
    view: createPollModal(command.channel_id, command.text),
  });

  await ack();
});

app.view("create", async ({ ack, payload, body, view, client }) => {
  const values = view.state.values;
  const othersCanAdd = values.options.options.selected_options.some(
    (v: Option) => v.value == "othersCanAdd"
  );

  let opts = Object.entries(values)
    .filter(([key, value]) => /option(\d+)/.test(key))
    .map(([key, value]) => value[key].value)
    .filter((i) => !!i);

  if (opts.length < 2 && !othersCanAdd) {
    await ack({
      response_action: "errors",
      errors: {
        option1:
          'You need at least 2 options to create a poll, unless "Allow others to add options" is checked',
      },
    });
    return;
  }

  const options = opts.map((opt) => {
    const option = new PollOption();

    option.name = opt;
    option.votes = [];

    return option;
  });

  if (
    (values.title.title.value as string).toLowerCase().includes("@channel") ||
    (values.title.title.value as string).toLowerCase().includes("<!channel>") ||
    (values.title.title.value as string).toLowerCase().includes("@everyone") ||
    (values.title.title.value as string)
      .toLowerCase()
      .includes("<!everyone>") ||
    (values.title.title.value as string).toLowerCase().includes("@here") ||
    (values.title.title.value as string).toLowerCase().includes("<!here>")
  ) {
    await ack({
      response_action: "errors",
      errors: {
        title: "Please don't ping the channel",
      },
    });
    return;
  }

  await ack();

  let poll = new Poll();

  poll.createdBy = body.user.id;
  poll.title = values.title.title.value;
  poll.options = options;
  poll.anonymous = values.options.options.selected_options.some(
    (v: Option) => v.value == "anonymous"
  );
  poll.multipleVotes = values.options.options.selected_options.some(
    (v: Option) => v.value == "multipleVotes"
  );
  poll.othersCanAdd = othersCanAdd;
  poll.channel = JSON.parse(view.private_metadata).channel;

  await createPoll(poll);
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

  if (poll.multipleVotes) {
    // the poll allows for multiple votes

    // check to see if the user's already voted for this option
    const userVote = await Vote.findOne(
      {
        user: body.user.id,
        poll: { id: parseInt(poll_id) },
        option: { id: parseInt(option_id) },
      },
      { relations: ["option"] }
    );

    if (userVote) {
      await userVote.remove();
      await refreshPoll(parseInt(poll_id));
      return;
    }
  } else {
    // the poll only allows 1 vote

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
  }

  // We've reached the end, so VOTE!!!
  const option = await PollOption.findOneOrFail(parseInt(option_id));

  // Create a vote
  const vote = new Vote();

  vote.user = body.user.id;
  vote.option = option;
  vote.poll = poll;

  await vote.save();

  // Refresh the poll
  await refreshPoll(parseInt(poll_id));
});

app.action(/addOption:(.+)/, async ({ ack, action, client, ...args }) => {
  await ack();

  const { trigger_id } = args.body as BlockAction;

  const action_id = (action as BlockElementAction).action_id;
  const matches = action_id.match(/addOption:(.+)/);
  if (!matches) {
    return;
  }

  const [, poll_id] = matches;

  let poll = await Poll.findOne(parseInt(poll_id));

  if (!poll || !poll.open || !poll.othersCanAdd) {
    return;
  }

  await client.views.open({
    trigger_id,
    view: {
      type: "modal",
      private_metadata: JSON.stringify({ poll: poll_id }),
      callback_id: "addOption",
      title: { type: "plain_text", text: "Add option" },
      submit: {
        type: "plain_text",
        text: "Add",
      },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Add an option to *${poll.title}*`,
          },
        },
        {
          type: "input",
          label: {
            type: "plain_text",
            text: "Option",
          },
          block_id: "option",
          element: {
            type: "plain_text_input",
            action_id: "option",
          },
        },
      ],
    },
  });
});

app.action("modalAddOption", async ({ ack, client, ...args }) => {
  const body = args.body as BlockAction;

  const { channel, optionCount } = JSON.parse(
    body.view?.private_metadata as string
  );

  client.views.update({
    view_id: body.view?.id,
    view: createPollModal(channel, "", optionCount + 1),
  });
});

app.view("addOption", async ({ view, body, ack }) => {
  await ack();

  const pollId = JSON.parse(view.private_metadata).poll;
  const optionName = view.state.values.option.option.value;

  const poll = await Poll.findOne(parseInt(pollId));

  if (!poll || !poll.open || !poll.othersCanAdd) {
    return;
  }

  const option = new PollOption();

  option.name = optionName;
  option.poll = poll;
  option.createdBy = body.user.id;

  await option.save();
  await refreshPoll(poll.id);
});

async function getPoll(id: number): Promise<Poll> {
  return await Poll.createQueryBuilder("poll")
    .leftJoinAndSelect("poll.options", "option")
    .leftJoinAndSelect("option.votes", "option.vote")
    .leftJoinAndSelect("poll.votes", "vote")
    .where("poll.id = :id", { id })
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
    entities: [Poll, PollOption, Vote, Token],
    synchronize: true,
  });

  await app.start(parseInt(process.env.PORT as string) || 3000);
  console.log("App started");
}

main();
