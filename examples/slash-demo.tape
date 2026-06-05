# quietclash /quietclash slash-command demo — VHS tape.
# Renders examples/slash-demo.gif: a Claude Code session where the user invokes
# the /quietclash slash command on three refs and Claude reports the hidden
# corridorsPerScreen broken-contract conflict.
#
#   vhs examples/slash-demo.tape
#
# The scenario + styled output live in examples/slash-demo.sh so the GIF runs
# the real engine.

Output examples/slash-demo.gif

Set Shell "bash"
Set FontSize 17
Set Width 1180
Set Height 940
Set Padding 26
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set PlaybackSpeed 1.0

# Render the session (real repo build + real engine run happen inside).
Type "bash examples/slash-demo.sh"
Sleep 500ms
Enter

# Let the build + engine run and the verdict paint in.
Sleep 9s

# Hold on the final verdict so it's readable.
Sleep 5s
