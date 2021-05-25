import { Block, InputBlock, KnownBlock, View } from "@slack/bolt";

const placeholder_options = [
  "Orpheus",
  "Steggy",
  "Caleb Deniosaur",
  "Rishiosaur",
];

export const inputBlocks = (
  initialTitle?: string,
  optionCount: number = 4
): (Block | KnownBlock)[] => {
  let options: InputBlock[] = [];

  for (let i = 0; i < optionCount; i++) {
    options.push({
      type: "input",
      label: { type: "plain_text", text: `Option ${i + 1}` },
      block_id: `option${i + 1}`,
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: `option${i + 1}`,
        ...(placeholder_options[i]
          ? {
              placeholder: {
                type: "plain_text",
                text: placeholder_options[i],
              },
            }
          : {}),
      },
    });
  }

  return [
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
            text: { type: "plain_text", text: "Make votes anonymous" },
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
        ...(initialTitle ? { initial_value: initialTitle } : {}),
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
    ...options,
  ];
};

export default (
  channel: string,
  initialTitle: string,
  optionCount: number = 4
): View => {
  return {
    type: "modal",
    callback_id: "create",
    private_metadata: JSON.stringify({ channel, optionCount }),
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
      ...inputBlocks(initialTitle, optionCount),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "modalAddOption",
            text: {
              type: "plain_text",
              text: "+ Add another option",
            },
          },
        ],
      },
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
