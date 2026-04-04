#!/bin/bash
# Status line wrapper: captures rate_limits from stdin, saves to file,
# then pipes stdin to the original status line command (ccstatusline)
INPUT=$(cat)

# Extract and save rate_limits in background (non-blocking)
echo "$INPUT" | python3 -c "
import sys, json, os, time
try:
    data = json.load(sys.stdin)
    rl = data.get('rate_limits')
    if not rl:
        sys.exit(0)
    fh = rl.get('five_hour') or {}
    sd = rl.get('seven_day') or {}
    out = {
        'blockPercent': fh.get('used_percentage'),
        'weeklyPercent': sd.get('used_percentage'),
        'blockResetAt': fh.get('resets_at'),
        'weeklyResetAt': sd.get('resets_at'),
        'timestamp': int(time.time() * 1000)
    }
    path = os.path.expanduser('~/.claude/usage-status.json')
    with open(path, 'w') as f:
        json.dump(out, f)
except:
    pass
" &

# Pass stdin to the original status line command
echo "$INPUT" | bunx -y ccstatusline@latest
