import "dotenv/config";

import {
  App,
  BlockAction,
  BlockElementAction,
  ExpressReceiver,
  Option,
} from "@slack/bolt";

import express from "express";

import createPollModal from "./modal";

import message from "./message";
import { checkInput } from "./util";
import JSXSlack, {
  Actions,
  Blocks,
  Button,
  Context,
  Divider,
  Input,
  Modal,
  Section,
} from "jsx-slack";
import { randomDinoFact } from "./dinoFacts";
import { PollWithOptions, prisma } from "./prisma";
import { Poll, PollOption, Vote } from "@prisma/client";

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

    const token = await prisma.token.findUnique({ where: { token: tok } });
    if (token === null) {
      throw new Error("invalid token");
    }

    let poll = await prisma.poll.create({
      data: {
        title,
        options: {
          createMany: {
            data: options.map((i: string) => ({
              name: i,
            })),
          },
        },
        channel,
        othersCanAdd,
        multipleVotes,
        createdBy: token.user,
      },
      include: { options: { select: { id: true, name: true } } },
    });

    const { timestamp } = await postPoll(poll);
    poll.timestamp = timestamp;

    res.json({
      ok: true,
      message: "woop woop you did it",
      poll,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      err: (err as any).message,
    });
  }
});

receiver.router.post("/toggle/:id", express.json(), async (req, res) => {
  try {
    const tok = req.headers.authorization?.slice("Bearer ".length);
    if (!tok) {
      throw new Error("no token provided");
    }

    const token = await prisma.token.findUnique({ where: { token: tok } });
    if (token === null) {
      throw new Error("invalid token");
    }

    // Find poll
    const poll = await prisma.poll.findUnique({
      where: {
        id: parseInt(req.params.id),
      },
    });
    if (!poll) {
      throw new Error("can't find poll");
    }

    await prisma.poll.update({
      where: {
        id: poll.id,
      },
      data: {
        open: !poll.open,
      },
    });

    await refreshPoll(poll.id);

    res.json({
      ok: true,
      message: "woop woop you did it",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      err: (err as any).message,
    });
  }
});

const app = new App({
  token: process.env.SLACK_TOKEN,
  receiver,
});

export async function postPoll(poll: Poll): Promise<Poll> {
  const resp = await app.client.chat.postMessage({
    blocks: message(await getPoll(poll.id)),
    text: "This message can't be displayed in your client.",
    channel: poll.channel,
    token: process.env.SLACK_TOKEN,
  });

  poll = await prisma.poll.update({
    where: {
      id: poll.id,
    },
    data: {
      timestamp: resp.message?.ts,
    },
  });

  if (poll.createdBy) {
    await app.client.chat.postEphemeral({
      text: `Poll successfully created! Run \`/dinopoll-toggle ${poll.id}\` to close the poll once you're done.`,
      blocks: JSXSlack(
        <Blocks>
          <Section>
            Poll successfully created! Run{" "}
            <code>/dinopoll-toggle {poll.id}</code> to close the poll once
            you're done.
            <Button actionId="dinoFact">:sauropod:</Button>
          </Section>
          <Context>
            :information_source: Remember to save your poll's ID (
            <code>{poll.id}</code>) if you'd like to close it later.
          </Context>
        </Blocks>
      ),
      channel: poll.channel,
      user: poll.createdBy,
      token: process.env.SLACK_TOKEN,
    });
  }

  return poll;
}

app.action("dinoFact", async ({ ack, body, client }) => {
  await ack();

  await client.chat.postEphemeral({
    channel: body.channel!.id!,
    user: body.user.id,
    text: `:sauropod: Here's a dinosaur fact:\n\n>>> ${randomDinoFact()}`,
  });
});

app.command("/dinopoll", async ({ client, ack, command }) => {
  await client.views.open({
    trigger_id: command.trigger_id,
    view: createPollModal(command.channel_id, command.text),
  });

  await ack();
});

app.view("create", async ({ ack, payload, body, view, client }) => {
  const values = view.state.values;
  const othersCanAdd = values.options.options.selected_options!.some(
    (v: Option) => v.value == "othersCanAdd"
  );

  let opts = Object.entries(values)
    .filter(([key, value]) => /option(\d+)/.test(key))
    .map(([key, value]) => value[key].value)
    .filter((i): i is string => !!i);

  if (opts.length < 2 && !othersCanAdd) {
    await ack({
      response_action: "errors",
      errors: {
        option1:
          'You need at least 2 options to create a poll, unless "Let others add options" is checked',
      },
    });
    return;
  }

  if (!checkInput(values.title.title.value!)) {
    await ack({
      response_action: "errors",
      errors: {
        title:
          "You are not in the sudoers file. This incident will be reported.",
      },
    });
    return;
  }

  const invalidOpts = opts.filter((opt) => !checkInput(opt));

  if (invalidOpts.length != 0) {
    await ack({
      response_action: "errors",
      errors: invalidOpts.reduce<Record<`option${number}`, string>>(
        (acc, _curr, idx) => {
          acc[`option${idx + 1}`] =
            "You are not in the sudoers file. This incident will be reported.";
          return acc;
        },
        {}
      ),
    });

    return;
  }

  await ack();

  let poll = await prisma.poll.create({
    data: {
      createdBy: body.user.id,
      title: values.title.title.value!,
      anonymous: values.options.options.selected_options?.some(
        (v) => v.value == "anonymous"
      ),
      multipleVotes: values.options.options.selected_options?.some(
        (v) => v.value == "multipleVotes"
      ),
      othersCanAdd,
      channel: JSON.parse(view.private_metadata).channel,
      options: {
        createMany: {
          data: opts.map((name) => ({ name })),
        },
      },
    },
  });

  await postPoll(poll);
});

app.command("/dinopoll-toggle", async ({ ack, command }) => {
  try {
    // Find poll
    const poll = await prisma.poll.findFirst({
      where: {
        id: parseInt(command.text),
        createdBy: command.user_id,
      },
    });
    if (!poll) {
      return await ack("poll not found.");
    }

    await prisma.poll.update({
      where: {
        id: poll.id,
      },
      data: {
        open: !poll.open,
      },
    });

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

  const [, pollId, optionId] = matches;

  const poll = await prisma.poll.findUnique({
    where: { id: parseInt(pollId) },
    include: {
      options: true,
    },
  });

  if (!poll || !poll.open) {
    return;
  }

  if (poll.multipleVotes) {
    // the poll allows for multiple votes

    // check to see if the user's already voted for this option
    const userVote = await prisma.vote.findUnique({
      where: {
        user_optionId: { user: body.user.id, optionId: parseInt(optionId) },
      },
      include: { option: true },
    });

    if (userVote) {
      await prisma.vote.delete({
        where: { id: userVote.id },
      });
      await refreshPoll(parseInt(pollId));
      return;
    }
  } else {
    // the poll only allows 1 vote

    // Check to see if the user's already voted
    const userVote = await prisma.vote.findFirst({
      where: {
        user: body.user.id,
        pollId: parseInt(pollId),
      },
      include: {
        option: true,
      },
    });

    if (userVote) {
      // They've already voted
      await prisma.vote.delete({
        where: { id: userVote.id },
      });

      // Are they voting for the same option? if so, don't switch their vote
      if (userVote.option.id == parseInt(optionId)) {
        await refreshPoll(parseInt(pollId));
        return;
      }
    }
  }

  // We've reached the end, so VOTE!!!
  await prisma.vote.create({
    data: {
      user: body.user.id,
      optionId: parseInt(optionId),
      pollId: poll.id,
    },
  });

  // Refresh the poll
  await refreshPoll(parseInt(pollId));
});

app.action(/addOption:(.+)/, async ({ ack, action, client, ...args }) => {
  await ack();

  const { trigger_id } = args.body as BlockAction;

  const action_id = (action as BlockElementAction).action_id;
  const matches = action_id.match(/addOption:(.+)/);
  if (!matches) {
    return;
  }

  const [, pollId] = matches;

  const poll = await prisma.poll.findUnique({
    where: {
      id: parseInt(pollId),
    },
  });

  if (!poll || !poll.open || !poll.othersCanAdd) {
    return;
  }

  await client.views.open({
    trigger_id,
    view: JSXSlack(
      <Modal title="Add Option" callbackId="addOption">
        <Section>
          Add an option to <b>{poll.title}</b>
        </Section>

        <Input label="Option" id="option" name="option" required />
        <Input type="hidden" name="poll" value={pollId} />

        <Input type="submit" value="Add" />
      </Modal>
    ),
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
  const pollId = JSON.parse(view.private_metadata).poll;
  const optionName = view.state.values.option.option.value!;

  if (!checkInput(optionName)) {
    await ack({
      response_action: "errors",
      errors: {
        option:
          "You are not in the sudoers file. This incident will be reported.",
      },
    });
    return;
  }

  await ack();

  const poll = await prisma.poll.findUnique({
    where: {
      id: parseInt(pollId),
    },
  });

  if (!poll || !poll.open || !poll.othersCanAdd) {
    return;
  }

  await prisma.pollOption.create({
    data: {
      name: optionName,
      pollId: poll.id,
      createdBy: body.user.id,
    },
  });

  await refreshPoll(poll.id);
});

async function getPoll(id: number): Promise<PollWithOptions> {
  const poll = await prisma.poll.findUnique({
    where: {
      id,
    },
    include: {
      options: {
        orderBy: { id: "asc" },
        include: { votes: { orderBy: { createdOn: "asc" } } },
      },
      _count: { select: { votes: true } },
    },
  });

  return poll!;
}

async function refreshPoll(pollId: number) {
  const poll = await getPoll(pollId);
  if (!poll) return;

  await app.client.chat.update({
    token: process.env.SLACK_TOKEN,
    text: "This message can't be displayed in your client.",
    blocks: message(poll),
    ts: poll.timestamp!,
    channel: poll.channel,
  });
}

async function main() {
  await app.start(parseInt(process.env.PORT as string) || 3000);
  console.log("App started");
}

main();
