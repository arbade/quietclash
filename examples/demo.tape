# quietclash demo — VHS tape. Renders examples/demo.gif deterministically.
#
#   vhs examples/demo.tape
#
# The actual scenario (throwaway repo, two agents, clean merge, the check) lives
# in examples/demo.sh so the GIF and the docs run the exact same thing.

Output examples/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1100
Set Height 760
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set PlaybackSpeed 1.0

# Title card
Type "# quietclash — catch behavioral merge conflicts git can't see"
Sleep 1200ms
Enter
Sleep 800ms

# Run the demo: two agents merge cleanly, quietclash finds the silent clash.
Type "bash examples/demo.sh"
Sleep 600ms
Enter

# Let the scenario build + the check run (~4s of work) and the result land.
Sleep 7s

# Hold on the verdict so a viewer can read it.
Sleep 4s
