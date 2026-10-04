# Magoomu Enterprises(Hardware)

Desktop app (Electron + React + SQLite) for a hardware shop: items, stock, sales, receipts, users and sales graphs.

## Run it (needs Node.js 18+)
```
npm install
npm run dev        # development window
npm run start      # build + run
npm run dist       # Windows installer (.exe) in /release
```

## First use
Click **First time? Register** to create the administrator account. The admin then adds other users on the **Users** page.

## Roles
| | Admin | User |
|---|---|---|
| Items, Stock (add/edit/delete), Users | yes | no |
| Make a sale | yes | no |
| View sales | all (today / week / month / last 100) | today only |
| Dashboard graphs (daily / weekly / monthly) | sales + stock figures | sales only |

## Notes
- Selling reduces stock oldest-first (by purchase date); expired stock is not sold.
- Stock rows turn orange when at or below "Reorder at".
- Every sale opens a receipt that can be printed.
- Passwords are stored as plain text, as requested. Anyone who can open the database file can read them.
- Data file: `%APPDATA%/Magoomu Enterprises(Hardware)/Magoomu Enterprises(Hardware).db`. Use **Export backup** to copy it.
