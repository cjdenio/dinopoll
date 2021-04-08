import { WorkflowStep, Option, Block, KnownBlock } from "@slack/bolt";
import { ValueTransformer } from "typeorm";
import { createPoll } from ".";
import { inputBlocks } from "./modal";
import Poll from "./models/Poll";
import PollOption from "./models/PollOption";

const ws = new WorkflowStep("create_poll_workflow_step", {
  edit: async ({ ack, step, configure }) => {
    await ack();

    const blocks: (Block | KnownBlock)[] = [
      {
        type: "input",
        block_id: "channel",
        label: {
          type: "plain_text",
          text: "Channel",
        },
        element: {
          type: "channels_select",
          placeholder: { type: "plain_text", text: "Select one..." },
          action_id: "channel",
        },
      },
      ...inputBlocks(),
    ];

    await configure({ blocks });
  },
  save: async ({ ack, view, update }) => {
    const values = view.state.values;

    const title = values.title.title.value;
    const channel = values.channel.channel.selected_channel;
    const othersCanAdd = values.options.options.selected_options.some(
      (v: Option) => v.value == "othersCanAdd"
    );
    const anonymous = values.options.options.selected_options.some(
      (v: Option) => v.value == "anonymous"
    );
    const multipleVotes = values.options.options.selected_options.some(
      (v: Option) => v.value == "multipleVotes"
    );

    const options = [
      values.option1.option1.value,
      values.option2.option2.value,
      values.option3.option3.value,
      values.option4.option4.value,
    ].filter((i) => i && i != "");

    if (options.length < 2 && !othersCanAdd) {
      await ack({
        response_action: "errors",
        errors: {
          option1:
            'You need at least 2 options to create a poll, unless "Allow others to add options" is checked',
        },
      });
      return;
    } else {
      await ack();
    }

    await update({
      inputs: {
        title: { value: title },
        othersCanAdd: { value: othersCanAdd },
        anonymous: { value: anonymous },
        multipleVotes: { value: multipleVotes },
        options: { value: options },
        channel: { value: channel },
      },
      step_name: `Create a poll: "${title}"`,
    });
  },
  execute: async ({ step, complete, fail }) => {
    try {
      const { inputs } = step;

      const options = inputs.options.value.map((i: string) => {
        const option = new PollOption();
        option.name = i;
        return option;
      });

      const poll = new Poll();

      poll.title = inputs.title.value;
      poll.options = options;
      poll.othersCanAdd = inputs.othersCanAdd.value;
      poll.multipleVotes = inputs.multipleVotes.value;
      poll.anonymous = inputs.anonymous.value;
      poll.channel = inputs.channel.value;

      await createPoll(poll);
      await complete();
    } catch (e) {
      await fail({ error: { message: e.message } });
    }
  },
});

export default ws;
