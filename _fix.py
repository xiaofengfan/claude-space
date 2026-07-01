with open("src/components/SkillMarketplace.tsx", "r", encoding="utf-8") as f:
    c = f.read()

old = "\t${createContent || '# ' + createName.trim() + '\n\t\n\t## Description\n' + (createDesc.trim() || 'No description')}`"
new = "\t${createContent || `# ${createName.trim()}\\n\\n## Description\\n${createDesc.trim() || 'No description'}`}`"
# Actually the issue is harder with escaped newlines. Let me just do a simple find and replace on the broken pattern.

# Find the exact broken text
import re
# Match everything from "${createContent" to the closing "}`" on the next lines
pattern = r'\$\{createContent \|\| \'# \' \+ createName\.trim\(\) \+ \'\n\n## Description\n\' \+ \(createDesc\.trim\(\) \|\| \'No description\'\)\}'
replacement = '${createContent || `# ${createName.trim()}\n\n## Description\n${createDesc.trim() || \'No description\'}`}'
c = re.sub(pattern, replacement, c)

with open("src/components/SkillMarketplace.tsx", "w", encoding="utf-8") as f:
    f.write(c)
print("Fixed")
