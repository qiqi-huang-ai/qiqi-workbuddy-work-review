# Security and privacy

## Reporting

Please report security issues privately to the repository owner instead of opening a public issue containing sensitive data.

## Data boundary

- WorkBuddy conversation files and database are read-only.
- Derived evidence and reviews are stored locally under `data/`.
- Real local data is ignored by Git.
- Clicking “Generate review” sends the selected evidence excerpt through the user's authenticated WorkBuddy CLI. No background model calls are made.
- Review generation disables tools and session persistence and limits the WorkBuddy run to one turn.

Never attach real conversation files, tokens, cookies, account identifiers, or private absolute paths to a public issue.
