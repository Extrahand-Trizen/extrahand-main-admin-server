# ExtraHand Main Admin Service

Main Admin Service for ExtraHand platform - handles authentication, Super Admin operations, and Main Admin Dashboard functionality.

## Features

- **Authentication**: Email/password login, JWT tokens, refresh tokens
- **Super Admin**: Manage admin users, create invites, manage dashboard access
- **User Management**: View, update, ban, suspend users
- **Task Management**: View, update, delete tasks and applications
- **Permission System**: Role-based access control with granular permissions
- **Audit Logging**: Comprehensive audit trail for all admin actions

## Architecture

This service acts as:
1. **Authentication Service**: Handles admin user authentication
2. **Super Admin Service**: Manages admin users and invites
3. **Main Admin Service**: Provides endpoints for Main Admin Dashboard operations

## Environment Variables

See `.env.example` for required environment variables.

## Installation

```bash
npm install
```

## Initial Setup

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### 2. Seed Super Admin

Create the initial super admin user:

```bash
# Using default credentials (admin@extrahand.in / Admin@123)
npm run seed:super-admin

# Or with custom credentials
SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD=SecurePass123 npm run seed:super-admin
```

**Default Credentials:**
- Email: `admin@extrahand.in`
- Password: `Admin@123`

⚠️ **Important**: Change the password after first login!

See `scripts/README.md` for more details.

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Production

```bash
npm run prod
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/verify` - Verify token
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/logout` - Logout

### Super Admin (requires super_admin role)
- `GET /api/v1/admin/users` - List admin users
- `POST /api/v1/admin/users` - Create admin user
- `PUT /api/v1/admin/users/:userId` - Update admin user
- `POST /api/v1/admin/users/:userId/dashboard-access` - Add dashboard access
- `DELETE /api/v1/admin/users/:userId/dashboard-access/:dashboardType` - Remove dashboard access
- `POST /api/v1/admin/invites` - Create invite
- `GET /api/v1/admin/invites` - List invites
- `POST /api/v1/admin/invites/:inviteId/resend` - Resend invite
- `DELETE /api/v1/admin/invites/:inviteId` - Cancel invite

### Main Admin - Users
- `GET /api/v1/users` - List users
- `GET /api/v1/users/:userId` - Get user
- `PATCH /api/v1/users/:userId` - Update user
- `POST /api/v1/users/:userId/ban` - Ban user
- `POST /api/v1/users/:userId/unban` - Unban user
- `POST /api/v1/users/:userId/suspend` - Suspend user
- `POST /api/v1/users/:userId/unsuspend` - Unsuspend user

### Main Admin - Tasks
- `GET /api/v1/tasks` - List tasks
- `GET /api/v1/tasks/:taskId` - Get task
- `PATCH /api/v1/tasks/:taskId` - Update task
- `DELETE /api/v1/tasks/:taskId` - Delete task
- `GET /api/v1/tasks/:taskId/applications` - Get task applications
- `PATCH /api/v1/tasks/:taskId/applications/:applicationId` - Update application status

### Main Admin - Support
- `GET /api/v1/support/tickets` - List support tickets (contact messages)
- `GET /api/v1/support/tickets/:ticketId` - Get support ticket
- `PATCH /api/v1/support/tickets/:ticketId/status` - Update ticket status
- `GET /api/v1/support/articles` - List support articles
- `GET /api/v1/support/articles/:articleId` - Get support article
- `POST /api/v1/support/articles` - Create support article
- `PATCH /api/v1/support/articles/:articleId` - Update support article
- `DELETE /api/v1/support/articles/:articleId` - Delete support article

### Public
- `POST /api/v1/invites/:inviteId/accept` - Accept invite (public)

## Permission System

Permissions follow the format: `<resource>.<action>`

Examples:
- `user.view` - View user
- `user.ban` - Ban user
- `task.delete` - Delete task
- `admin.user.create` - Create admin user

See `src/types/permissions.ts` for full permission definitions.

## Database Models

- **AdminUser**: Admin user accounts with multi-dashboard access
- **AdminInvite**: Invitation system for onboarding new admins
- **AuditLog**: Audit trail for all admin actions

## Service Dependencies

- **User Service**: For user management operations
- **Task Service**: For task management operations
- **Support Service**: For support ticket and article management (runs on port 5001)
- **Email Service**: For sending invite emails

## Integration with Support Portal

This service integrates with the existing `extrahand-platform-support-service` (runs on port 5001):
- **Support Tickets**: Manages contact messages from the support portal
- **Support Articles**: Manages knowledge base articles

### Required Support Service Endpoints

The following endpoints need to be added to `extrahand-platform-support-service` for full functionality:

1. **Contact Messages:**
   - `GET /api/contact/:id` - Get single contact message by ID
   - `PATCH /api/contact/:id/status` - Update contact message status

2. **Articles (Admin):**
   - `POST /api/articles` - Create article (requires admin auth)
   - `PATCH /api/articles/:id` - Update article (requires admin auth)
   - `DELETE /api/articles/:id` - Delete article (requires admin auth)

**Note**: The main-admin-service will gracefully handle missing endpoints with appropriate error messages. You can add these endpoints to the support service as needed.
