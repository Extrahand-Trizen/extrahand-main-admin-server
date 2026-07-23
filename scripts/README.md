# Seed Scripts

This directory contains database seed scripts for the Main Admin Service.

## Super Admin Seed

Creates the initial super admin user for the Main Admin Dashboard.

### Usage

```bash
# Using default credentials (admin@extrahand.in / Admin@123)
npm run seed:super-admin

# Using custom credentials via environment variables
SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD=SecurePass123 npm run seed:super-admin

# Using command line arguments
npm run seed:super-admin -- --email admin@example.com --password SecurePass123 --name "Admin Name"
```

### Default Credentials

- **Email**: `admin@extrahand.in`
- **Password**: `Admin@123`
- **Name**: `Super Admin`

⚠️ **Important**: Change the password after first login!

### What It Does

1. Connects to MongoDB using your `.env` configuration
2. Checks if a super admin already exists
3. If exists and is already super admin, skips creation
4. If exists but not super admin, upgrades to super admin
5. If doesn't exist, creates a new super admin user with:
   - `isSuperAdmin: true`
   - Access to `main_admin` dashboard
   - Active status
   - Hashed password

### Environment Variables

You can set these in your `.env` file:

```env
SUPER_ADMIN_EMAIL=admin@extrahand.in
SUPER_ADMIN_PASSWORD=Admin@123
SUPER_ADMIN_NAME=Super Admin
```

### Requirements

- MongoDB must be running and accessible
- `.env` file must be configured with `MONGODB_URI`
- Database connection must be successful

### Troubleshooting

**Error: Cannot find module 'ts-node'**
```bash
npm install --save-dev ts-node
```

**Error: MongoDB connection failed**
- Check your `MONGODB_URI` in `.env`
- Ensure MongoDB is running
- Verify network connectivity

**Error: User already exists**
- The script will skip if super admin already exists
- To update an existing user, delete it first or the script will upgrade it
