with open('eas_build_log.txt', 'r', encoding='utf-8', errors='replace') as f:
    text = f.read()

lines = text.splitlines()
print(f"Total lines: {len(lines)}")

# Find all occurrences of error, fail, or exception
matching = []
for i, line in enumerate(lines):
    l_lower = line.lower()
    if any(k in l_lower for k in ['failure:', 'failed', 'error:', 'exception', 'fatal', 'could not find', 'unable to resolve', 'cannot find']):
        matching.append((i, line))

with open('summary_errors.txt', 'w', encoding='utf-8') as out:
    out.write(f"Found {len(matching)} matching lines.\n")
    for idx, line in matching[-30:]:
        out.write(f"L{idx}: {line}\n")
    
    out.write("\n\n--- LAST 100 LINES ---\n")
    for l in lines[-100:]:
        out.write(l + "\n")

print("Wrote summary_errors.txt")

