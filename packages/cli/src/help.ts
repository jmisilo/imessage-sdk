export function rootHelp(): string {
  return `Usage: imessage-cli <command> [options]

Send and interact with iMessage through Blooio, Photon, or Sendblue.

Options:
  -V, -v, --version            output the version number
  --json                       output stable JSON instead of text
  --config <path>              use a specific CLI configuration file
  --no-input                   error instead of prompting for missing values
  -h, --help                   display help for command

Commands:
  send                         send text, attachments, or replies
  message get                  get a provider-native message
  conversation <command>       open, get, or mark a conversation as read
  attachment download          download an inbound attachment
  reaction <command>           add or remove a reaction
  typing <command>             start or stop a typing indicator
  provider <command>           inspect providers and provider extensions
  connection <command>         manage secure saved connections
  config <command>             initialize or validate local configuration
  schema [command]             print agent-facing JSON Schemas
  completion <shell>           generate shell completion
  webhook serve                run the experimental local webhook server

Run imessage-cli <command> --help for detailed command options.
`;
}
