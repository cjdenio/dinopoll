import { Block, KnownBlock, View } from "@slack/bolt";

const placeholder_options = [
  "Orpheus",
  "Steggy",
  "Caleb Deniosaur",
  "Rishiosaur",
];

export const inputBlocks = (initialTitle?: string): (Block | KnownBlock)[] => [
  {
    type: "input",
    optional: true,
    label: {
      type: "plain_text",
      text: "Options",
    },
    block_id: "options",
    element: {
      action_id: "options",
      type: "checkboxes",
      options: [
        {
          text: { type: "plain_text", text: "Anonymous poll" },
          value: "anonymous",
        },
        {
          text: {
            type: "plain_text",
            text: "Allow voting for multiple options",
          },
          value: "multipleVotes",
        },
        {
          text: {
            type: "plain_text",
            text: "Allow others to add options",
          },
          value: "othersCanAdd",
        },
      ],
    },
  },
  {
    type: "input",
    block_id: "title",
    label: {
      type: "plain_text",
      text: "Poll question",
    },
    element: {
      initial_value: initialTitle,
      action_id: "title",
      type: "plain_text_input",
      placeholder: {
        type: "plain_text",
        text: "Who is the best dino?",
      },
    },
  },
  {
    type: "divider",
  },
  ...placeholder_options.map((item, index): Block | KnownBlock => {
    return {
      type: "input",
      label: { type: "plain_text", text: `Option ${index + 1}` },
      block_id: `option${index + 1}`,
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: `option${index + 1}`,
        placeholder: {
          type: "plain_text",
          text: item,
        },
      },
    };
  }),
];

export default (channel: string, initialTitle: string): View => {
  return {
    type: "modal",
    callback_id: "create",
    private_metadata: JSON.stringify({ channel }),
    title: {
      type: "plain_text",
      text: "Create Poll",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Send a poll to the <#${channel}> channel`,
        },
      },
      ...inputBlocks(initialTitle),
    ],
    submit: {
      type: "plain_text",
      text: "Create",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
  };
};
