import { View } from "@slack/bolt";
import JSXSlack, {
  Actions,
  Button,
  Checkbox,
  CheckboxGroup,
  Divider,
  Fragment,
  Input,
  Modal,
  Section,
} from "jsx-slack";

const placeholderOptions = [
  "Orpheus",
  "Steggy",
  "Caleb Deniosaur",
  "Rishiosaur",
];

const InputBlocks = ({
  initialTitle,
  optionCount = 4,
}: {
  initialTitle?: string;
  optionCount: number;
}) => {
  return (
    <Fragment>
      <CheckboxGroup id="options" label="Options" actionId="options">
        <Checkbox value="anonymous">Make votes anonymous</Checkbox>
        <Checkbox value="multipleVotes">
          Allow voting for multiple options
        </Checkbox>
        <Checkbox value="othersCanAdd">Let others add options</Checkbox>
      </CheckboxGroup>

      <Input
        label="Poll question"
        id="title"
        actionId="title"
        placeholder="Who is the best dino?"
        value={initialTitle}
        required
      />

      <Divider />

      {Array.from(Array(optionCount).keys()).map((i) => (
        <Input
          label={`Option ${i + 1}`}
          id={`option${i + 1}`}
          actionId={`option${i + 1}`}
          placeholder={placeholderOptions[i]}
        />
      ))}
    </Fragment>
  );
};

export default (
  channel: string,
  initialTitle: string,
  optionCount: number = 4
): View => {
  return JSXSlack(
    <Modal type="modal" title="Create Poll" callbackId="create" close="Cancel">
      <Section>
        Send a poll to the <a href={`#${channel}`} /> channel
      </Section>

      <InputBlocks optionCount={optionCount} initialTitle={initialTitle} />

      <Actions>
        <Button actionId="modalAddOption">+ Add another option</Button>
      </Actions>

      <Input type="hidden" name="channel" value={channel} />
      <Input type="hidden" name="optionCount" value={optionCount} />

      <Input type="submit" value="Create" />
    </Modal>
  );
};
