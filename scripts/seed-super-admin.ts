import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { AdminUser } from '../src/models/AdminUser';
import { DashboardType } from '../src/types/dashboard';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import logger from '../src/config/logger';

// Load environment variables
dotenv.config();

interface SeedOptions {
  email?: string;
  password?: string;
  name?: string;
}

async function seedSuperAdmin(options: SeedOptions = {}) {
  try {
    // Connect to database
    await connectDatabase();

    const email = options.email || process.env.SUPER_ADMIN_EMAIL || 'operationsmanager@extrahand.in';
    const password = options.password || process.env.SUPER_ADMIN_PASSWORD || 'operationsmanager@123';
    const name = options.name || process.env.SUPER_ADMIN_NAME || 'Operations Manager';

    // Check if super admin already exists
    const existingAdmin = await AdminUser.findOne({ email: email.toLowerCase() });
    
    if (existingAdmin) {
      if (existingAdmin.isSuperAdmin) {
        logger.info(`✅ Super admin already exists: ${email}`);
        logger.info('   Skipping seed...');
        await disconnectDatabase();
        process.exit(0);
      } else {
        // Update existing user to super admin
        logger.info(`⚠️  User exists but is not super admin: ${email}`);
        logger.info('   Updating to super admin...');
        
        existingAdmin.isSuperAdmin = true;
        existingAdmin.status = 'active';
        
        // Add main_admin dashboard access if not exists
        const hasMainAdminAccess = existingAdmin.dashboardAccess.some(
          (access) => access.dashboardType === DashboardType.MAIN_ADMIN
        );
        
        if (!hasMainAdminAccess) {
          existingAdmin.dashboardAccess.push({
            dashboardType: DashboardType.MAIN_ADMIN,
            role: 'super_admin',
            status: 'active',
            permissions: [], // Super admin has all permissions
            grantedBy: 'system',
            grantedAt: new Date(),
          });
        }
        
        // Update password if provided
        if (password) {
          const saltRounds = 10;
          existingAdmin.passwordHash = await bcrypt.hash(password, saltRounds);
        }
        
        await existingAdmin.save();
        logger.info(`✅ Updated user to super admin: ${email}`);
        await disconnectDatabase();
        process.exit(0);
      }
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create super admin user
    const superAdmin = new AdminUser({
      userId: `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      email: email.toLowerCase(),
      passwordHash,
      name,
      isSuperAdmin: true,
      status: 'active',
      joinedVia: 'email',
      loginCount: 0,
      dashboardAccess: [
        {
          dashboardType: DashboardType.MAIN_ADMIN,
          role: 'super_admin',
          status: 'active',
          permissions: [], // Super admin has all permissions
          grantedBy: 'system',
          grantedAt: new Date(),
        },
      ],
      createdBy: 'system',
    });

    await superAdmin.save();

    logger.info('✅ Super admin created successfully!');
    logger.info(`   Email: ${email}`);
    logger.info(`   Password: ${password}`);
    logger.info(`   Name: ${name}`);
    logger.info('   ⚠️  Please change the password after first login!');

    await disconnectDatabase();
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Error seeding super admin:', error);
    await disconnectDatabase();
    process.exit(1);
  }
}

// Run seed if called directly
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options: SeedOptions = {};
  
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    if (key && value) {
      options[key as keyof SeedOptions] = value;
    }
  }

  seedSuperAdmin(options);
}

export { seedSuperAdmin };
