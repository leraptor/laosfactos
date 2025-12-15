---
description: Deploy Laosfactos to Firebase (functions + hosting)
---

# Deploy to Firebase

// turbo-all

1. Build the frontend:
```bash
npm run build
```

2. Deploy functions and hosting:
```bash
firebase deploy --only functions,hosting
```

3. Verify deployment succeeded and report the console URL to the user.
