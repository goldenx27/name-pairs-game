# User management / RBAC

## Roles

### SUPER_ADMIN
- Global access across all families and children.
- Manage the global character catalog (images/audio).
- View D1/R2 operational dashboards and storage audit.
- Create family admins, parents and children.
- Assign/remove parents to/from children.
- View every child's progress.

### FAMILY_ADMIN
- Scoped to one or more assigned families.
- Manage parents and children inside those families.
- Assign parents to children in those families.
- View progress for every child in those families.
- Does not manage the global character catalog or R2/D1 operational tools.

### PARENT
- Scoped only to explicitly assigned children.
- Add a child to their family or remove a child they manage.
- View dashboards/progress for their assigned children.
- Cannot assign another parent to a child.
- Cannot access global character/R2/D1 administration.

### CHILD
- Maps to an existing `players` row.
- Can enter the game and play only.
- No parent/admin dashboards or management endpoints.

## Data model
- `app_users`: login identity and global role.
- `family_memberships`: user role within a family.
- `child_accounts`: maps a CHILD user to the existing `players` profile.
- `parent_children`: explicit guardian-to-child permissions.
- `auth_sessions`: server-side login sessions so identity is not tied to localStorage/device.

Existing `players`, `player_state`, `player_character_state`, sessions/events and progress data remain unchanged.

## Recommended login UX
- SUPER_ADMIN / FAMILY_ADMIN / PARENT: email + password.
- CHILD: simple username/avatar + numeric PIN, optionally remembered on the child's device.
- A device may switch between child profiles without creating new progress.

## Authorization rule
Every protected API endpoint must authorize server-side. Hiding a button in the UI is never considered authorization.
