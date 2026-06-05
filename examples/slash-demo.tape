# quietclash /quietclash slash-command demo — VHS tape.
# Renders examples/slash-demo.gif: the user launches Claude Code, runs the
# /quietclash slash command on three refs, and Claude reports the hidden
# corridorsPerScreen broken-contract conflict.
#
#   vhs examples/slash-demo.tape
#
# The splash, prompt-box typing, autocomplete, and verdict are produced by
# examples/slash-demo.sh, which builds a real repo and runs the real engine.

Output examples/slash-demo.gif

Set Shell "bash"
Set FontSize 17
Set Width 1180
Set Height 1000
Set Padding 26
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms
Set PlaybackSpeed 1.0

# The user types the launch command for Claude Code (visible) — but we do NOT
# press Enter on it, so the real `claude` binary never starts. We clear the line
# and run the staged session instead, which renders its own faithful splash.
Type "claude"
Sleep 600ms
Ctrl+U

Hide
Type "clear && bash examples/slash-demo.sh"
Enter
Show

# Splash + prompt-box typing + autocomplete + engine run + verdict paint in.
Sleep 13s

# Hold on the final verdict so it's readable.
Sleep 5s
