import { Request, Response } from 'express';
import logger from '../config/logger';
import { QcOrder } from '../models/QcOrder';
import { QcCategory, QcSubcategory, QcSellerOnboarding } from '../models/QcCatalogueModels';

const DEFAULT_SAMPLE_ORDERS = [
  {
    userId: 'user_cust_101',
    orderNumber: '#ORD1042',
    shopName: 'Kirana',
    shopCategory: 'Kirana & Grocery',
    shopSubcategory: 'Atta & Flours',
    status: 'open' as const,
    paymentStatus: 'PAID' as const,
    amountPaise: 34000,
    amount: 340,
    itemTotalPaise: 31000,
    deliveryFeePaise: 2500,
    handlingFeePaise: 500,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    opsAdmin: {
      userId: 'ops_1',
      name: 'Durgamshiva',
      email: 'durgamshiva@extrahand.in',
    },
    deadline: new Date('2026-09-02T18:00:00.000Z'),
    createdAt: new Date('2026-09-02T10:30:00.000Z'),
    address: {
      line1: 'Flat 402, Sunshine Heights',
      line2: 'Madhapur',
      city: 'Hyderabad',
      state: 'Telangana',
      pinCode: '500081',
      name: 'Kavya Reddy',
      phone: '+91 98765 43210',
    },
    deliveryInstructions: ['Leave at door', 'Ring bell once'],
    items: [
      {
        name: 'Aashirvaad Superior MP Shudh Chakki Atta',
        unit: '5 kg',
        quantity: 1,
        unitPricePaise: 26000,
        lineTotalPaise: 26000,
      },
      {
        name: 'Tata Salt Vacuum Evaporated Iodised Salt',
        unit: '1 kg',
        quantity: 2,
        unitPricePaise: 2500,
        lineTotalPaise: 5000,
      },
    ],
  },
  {
    userId: 'user_cust_102',
    orderNumber: '#ORD1041',
    shopName: 'Allam Shop',
    shopCategory: 'Fruits & Vegetables',
    shopSubcategory: 'Fresh Vegetables',
    status: 'assigned' as const,
    paymentStatus: 'PAID' as const,
    amountPaise: 12000,
    amount: 120,
    itemTotalPaise: 10000,
    deliveryFeePaise: 1500,
    handlingFeePaise: 500,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    assignedTo: {
      userId: 'helper_201',
      profileId: 'prof_201',
      name: 'Ravi Teja',
      phone: '+91 91234 56789',
      role: 'helper',
      assignedAt: new Date('2026-09-01T14:10:00.000Z'),
    },
    opsAdmin: {
      userId: 'ops_1',
      name: 'Durgamshiva',
      email: 'durgamshiva@extrahand.in',
    },
    deadline: new Date('2026-09-01T20:00:00.000Z'),
    createdAt: new Date('2026-09-01T13:45:00.000Z'),
    address: {
      line1: 'House 12-3/A, Green Hills Colony',
      line2: 'Gachibowli',
      city: 'Hyderabad',
      state: 'Telangana',
      pinCode: '500032',
      name: 'Anil Kumar',
      phone: '+91 98451 23456',
    },
    deliveryInstructions: ['Call upon arrival'],
    items: [
      {
        name: 'Fresh Allam (Ginger)',
        unit: '250 g',
        quantity: 1,
        unitPricePaise: 6000,
        lineTotalPaise: 6000,
      },
      {
        name: 'Fresh Garlic (Vellulli)',
        unit: '250 g',
        quantity: 1,
        unitPricePaise: 4000,
        lineTotalPaise: 4000,
      },
    ],
  },
  {
    userId: 'user_cust_103',
    orderNumber: '#ORD1040',
    shopName: 'Kirana',
    shopCategory: 'Kirana & Grocery',
    shopSubcategory: 'Dairy & Breakfast',
    status: 'completed' as const,
    paymentStatus: 'PAID' as const,
    amountPaise: 56000,
    amount: 560,
    itemTotalPaise: 53000,
    deliveryFeePaise: 2500,
    handlingFeePaise: 500,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    assignedTo: {
      userId: 'helper_202',
      profileId: 'prof_202',
      name: 'Sri Charan',
      phone: '+91 97000 11223',
      role: 'helper',
      assignedAt: new Date('2026-09-01T10:05:00.000Z'),
    },
    opsAdmin: {
      userId: 'ops_1',
      name: 'Durgamshiva',
      email: 'durgamshiva@extrahand.in',
    },
    deadline: new Date('2026-09-01T16:00:00.000Z'),
    createdAt: new Date('2026-09-01T09:30:00.000Z'),
    address: {
      line1: 'B-601, Cyber Towers Residency',
      line2: 'Hitec City',
      city: 'Hyderabad',
      state: 'Telangana',
      pinCode: '500081',
      name: 'Pooja Hegde',
      phone: '+91 99887 76655',
    },
    deliveryInstructions: [],
    items: [
      {
        name: 'Heritage Special Buffalo Milk',
        unit: '1 L',
        quantity: 2,
        unitPricePaise: 8000,
        lineTotalPaise: 16000,
      },
      {
        name: 'Amul Butter Salted',
        unit: '500 g',
        quantity: 1,
        unitPricePaise: 27500,
        lineTotalPaise: 27500,
      },
      {
        name: 'Modern White Bread',
        unit: '400 g',
        quantity: 1,
        unitPricePaise: 9500,
        lineTotalPaise: 9500,
      },
    ],
  },
  {
    userId: 'user_cust_104',
    orderNumber: '#ORD1039',
    shopName: 'Allam Shop',
    shopCategory: 'Fruits & Vegetables',
    shopSubcategory: 'Fresh Vegetables',
    status: 'cancelled' as const,
    paymentStatus: 'FAILED' as const,
    amountPaise: 9900,
    amount: 99,
    itemTotalPaise: 9900,
    deliveryFeePaise: 0,
    handlingFeePaise: 0,
    couponDiscountPaise: 0,
    partnerTipPaise: 0,
    opsAdmin: {
      userId: 'ops_1',
      name: 'Durgamshiva',
      email: 'durgamshiva@extrahand.in',
    },
    deadline: new Date('2026-08-31T20:00:00.000Z'),
    createdAt: new Date('2026-08-31T18:15:00.000Z'),
    address: {
      line1: 'Plot 45, Jubilee Enclave',
      line2: 'Kondapur',
      city: 'Hyderabad',
      state: 'Telangana',
      pinCode: '500084',
      name: 'Vikram Rao',
      phone: '+91 94400 55667',
    },
    deliveryInstructions: ['Customer cancelled: Item unavailable'],
    items: [
      {
        name: 'Fresh Coriander (Kothimeera)',
        unit: '2 bunches',
        quantity: 2,
        unitPricePaise: 2500,
        lineTotalPaise: 5000,
      },
      {
        name: 'Fresh Mint (Pudina)',
        unit: '2 bunches',
        quantity: 2,
        unitPricePaise: 2450,
        lineTotalPaise: 4900,
      },
    ],
  },
];

const DEFAULT_CATEGORIES = [
  { name: 'Kirana & Grocery', slug: 'grocery-staples', code: 'GROC' },
  { name: 'Fruits & Vegetables', slug: 'fruits-vegetables', code: 'FRESH' },
  { name: 'Dairy & Breakfast', slug: 'dairy-breakfast', code: 'DAIRY' },
  { name: 'Snacks & Beverages', slug: 'snacks-beverages', code: 'SNACK' },
  { name: 'Personal Care', slug: 'personal-care', code: 'PCARE' },
  { name: 'Cleaning & Household', slug: 'cleaning-household', code: 'CLEAN' },
];

const DEFAULT_SUBCATEGORIES = [
  { name: 'Atta & Flours', slug: 'atta-flours', categorySlug: 'grocery-staples' },
  { name: 'Dal & Pulses', slug: 'dal-pulses', categorySlug: 'grocery-staples' },
  { name: 'Rice & Grains', slug: 'rice-grains', categorySlug: 'grocery-staples' },
  { name: 'Edible Oils & Ghee', slug: 'edible-oils-ghee', categorySlug: 'grocery-staples' },
  { name: 'Fresh Vegetables', slug: 'fresh-vegetables', categorySlug: 'fruits-vegetables' },
  { name: 'Fresh Fruits', slug: 'fresh-fruits', categorySlug: 'fruits-vegetables' },
  { name: 'Milk & Butter', slug: 'milk-butter', categorySlug: 'dairy-breakfast' },
  { name: 'Bread & Bakery', slug: 'bread-bakery', categorySlug: 'dairy-breakfast' },
  { name: 'Chips & Namkeen', slug: 'chips-namkeen', categorySlug: 'snacks-beverages' },
  { name: 'Soft Drinks & Juices', slug: 'soft-drinks-juices', categorySlug: 'snacks-beverages' },
];

const DEFAULT_SHOPS = [
  { shopName: 'Kirana', shopType: 'Grocery Store', city: 'Hyderabad', area: 'Madhapur' },
  { shopName: 'Allam Shop', shopType: 'Vegetables & Spices', city: 'Hyderabad', area: 'Gachibowli' },
  { shopName: 'Sri Balaji Supermarket', shopType: 'Supermarket', city: 'Hyderabad', area: 'Kondapur' },
  { shopName: 'Fresh Mart QCommerce', shopType: 'Quick Commerce Hub', city: 'Hyderabad', area: 'Hitec City' },
];

async function ensureInitialData(): Promise<void> {
  try {
    const orderCount = await QcOrder.countDocuments();
    if (orderCount === 0) {
      logger.info('Seeding default Qcommerce orders for Operational Portal');
      await QcOrder.insertMany(DEFAULT_SAMPLE_ORDERS);
    }
  } catch (error) {
    logger.error('Error ensuring initial Qcommerce data:', error);
  }
}

export class QcommerceOrderController {
  /**
   * GET /api/v1/qcommerce/orders
   */
  static async listOrders(req: Request, res: Response): Promise<void> {
    try {
      await ensureInitialData();

      const search = String(req.query.search || '').trim();
      const status = String(req.query.status || 'all').trim();
      const shop = String(req.query.shop || 'all').trim();
      const category = String(req.query.category || 'all').trim();
      const subcategory = String(req.query.subcategory || 'all').trim();
      const assignedTo = String(req.query.assignedTo || 'all').trim();
      const deadlineSortOrder = String(req.query.deadlineSortOrder || req.query.sortOrder || 'desc').trim();
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || '20'), 10)));

      const filter: Record<string, any> = {};

      if (search) {
        const searchRegex = { $regex: search, $options: 'i' };
        filter.$or = [
          { orderNumber: searchRegex },
          { shopName: searchRegex },
          { 'address.name': searchRegex },
          { 'address.phone': searchRegex },
          { 'address.line1': searchRegex },
          { 'assignedTo.name': searchRegex },
          { 'opsAdmin.name': searchRegex },
        ];
      }

      if (status && status !== 'all') {
        filter.status = status;
      }

      if (shop && shop !== 'all') {
        filter.shopName = { $regex: `^${shop}$`, $options: 'i' };
      }

      if (category && category !== 'all') {
        filter.$or = [
          { shopCategory: { $regex: `^${category}$`, $options: 'i' } },
          { 'items.productSlug': { $regex: category, $options: 'i' } },
        ];
      }

      if (subcategory && subcategory !== 'all') {
        filter.shopSubcategory = { $regex: `^${subcategory}$`, $options: 'i' };
      }

      if (assignedTo && assignedTo !== 'all') {
        if (assignedTo === 'unassigned') {
          filter.$or = [
            { 'assignedTo.name': { $exists: false } },
            { 'assignedTo.name': null },
            { 'assignedTo.name': '' },
          ];
        } else {
          filter.$or = [
            { 'assignedTo.name': { $regex: assignedTo, $options: 'i' } },
            { 'opsAdmin.name': { $regex: assignedTo, $options: 'i' } },
          ];
        }
      }

      const sortDir = deadlineSortOrder === 'asc' ? 1 : -1;
      const sort: Record<string, 1 | -1> = {
        deadline: sortDir,
        createdAt: -1,
      };

      const [total, rawOrders] = await Promise.all([
        QcOrder.countDocuments(filter),
        QcOrder.find(filter)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);

      const orders = rawOrders.map((order: any) => {
        const amount =
          typeof order.amount === 'number'
            ? order.amount
            : (order.amountPaise || 0) / 100;

        return {
          ...order,
          id: String(order._id),
          amount,
          amountPaise: order.amountPaise || Math.round(amount * 100),
          status: order.status || 'open',
          shopName: order.shopName || 'Shop',
          opsAdminName: order.opsAdmin?.name || 'Durgamshiva',
          assignedHelperName: order.assignedTo?.name || null,
        };
      });

      res.json({
        success: true,
        data: orders,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (error: any) {
      logger.error('Failed to list Qcommerce orders:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list Qcommerce orders',
      });
    }
  }

  /**
   * GET /api/v1/qcommerce/orders/:id
   */
  static async getOrder(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const order = await QcOrder.findOne({
        $or: [
          { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
          { orderNumber: id },
          { orderNumber: id.startsWith('#') ? id : `#${id}` },
        ].filter(Boolean),
      }).lean();

      if (!order) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      const amount =
        typeof order.amount === 'number'
          ? order.amount
          : (order.amountPaise || 0) / 100;

      res.json({
        success: true,
        data: {
          ...order,
          id: String(order._id),
          amount,
        },
      });
    } catch (error: any) {
      logger.error('Failed to get Qcommerce order:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get Qcommerce order',
      });
    }
  }

  /**
   * POST /api/v1/qcommerce/orders/:id/assign
   */
  static async assignHelper(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { helperUid, helperProfileId, helperName, helperPhone, role = 'helper' } = req.body;

      if (!helperUid && !helperProfileId && !helperName) {
        res.status(400).json({ success: false, error: 'Helper details are required' });
        return;
      }

      const order = await QcOrder.findOne({
        $or: [
          { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
          { orderNumber: id },
          { orderNumber: id.startsWith('#') ? id : `#${id}` },
        ].filter(Boolean),
      });

      if (!order) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      order.assignedTo = {
        userId: helperUid || order.assignedTo?.userId,
        profileId: helperProfileId || order.assignedTo?.profileId,
        name: helperName || order.assignedTo?.name,
        phone: helperPhone || order.assignedTo?.phone,
        role,
        assignedAt: new Date(),
      };

      if (order.status === 'open') {
        order.status = 'assigned';
      }

      await order.save();

      res.json({
        success: true,
        data: order,
        message: `Helper ${helperName || ''} assigned successfully`,
      });
    } catch (error: any) {
      logger.error('Failed to assign helper to Qcommerce order:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to assign helper',
      });
    }
  }

  /**
   * PATCH /api/v1/qcommerce/orders/:id/status
   */
  static async updateOrderStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        res.status(400).json({ success: false, error: 'Status is required' });
        return;
      }

      const order = await QcOrder.findOne({
        $or: [
          { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
          { orderNumber: id },
          { orderNumber: id.startsWith('#') ? id : `#${id}` },
        ].filter(Boolean),
      });

      if (!order) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      order.status = status;
      await order.save();

      res.json({
        success: true,
        data: order,
        message: 'Order status updated successfully',
      });
    } catch (error: any) {
      logger.error('Failed to update Qcommerce order status:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update status',
      });
    }
  }

  /**
   * GET /api/v1/qcommerce/categories
   */
  static async getCategories(_req: Request, res: Response): Promise<void> {
    try {
      const categories = await QcCategory.find({ status: { $ne: 'INACTIVE' } })
        .sort({ displayOrder: 1, name: 1 })
        .select('name slug code imageUrl')
        .lean();

      if (!categories || categories.length === 0) {
        res.json({
          success: true,
          data: DEFAULT_CATEGORIES.map((c, i) => ({
            id: `cat_${i + 1}`,
            name: c.name,
            slug: c.slug,
            code: c.code,
          })),
        });
        return;
      }

      res.json({
        success: true,
        data: categories.map((c: any) => ({
          id: String(c._id),
          name: c.name,
          slug: c.slug,
          code: c.code,
          imageUrl: c.imageUrl,
        })),
      });
    } catch (error: any) {
      logger.error('Failed to fetch categories:', error);
      res.json({
        success: true,
        data: DEFAULT_CATEGORIES.map((c, i) => ({
          id: `cat_${i + 1}`,
          name: c.name,
          slug: c.slug,
          code: c.code,
        })),
      });
    }
  }

  /**
   * GET /api/v1/qcommerce/subcategories
   */
  static async getSubcategories(req: Request, res: Response): Promise<void> {
    try {
      const categoryId = req.query.categoryId ? String(req.query.categoryId) : undefined;
      const filter: Record<string, any> = { status: { $ne: 'INACTIVE' } };
      if (categoryId) {
        filter.categoryId = categoryId;
      }

      const subcategories = await QcSubcategory.find(filter)
        .sort({ displayOrder: 1, name: 1 })
        .select('name slug categoryId')
        .lean();

      if (!subcategories || subcategories.length === 0) {
        res.json({
          success: true,
          data: DEFAULT_SUBCATEGORIES.map((s, i) => ({
            id: `sub_${i + 1}`,
            name: s.name,
            slug: s.slug,
            categorySlug: s.categorySlug,
          })),
        });
        return;
      }

      res.json({
        success: true,
        data: subcategories.map((s: any) => ({
          id: String(s._id),
          name: s.name,
          slug: s.slug,
          categoryId: String(s.categoryId),
        })),
      });
    } catch (error: any) {
      logger.error('Failed to fetch subcategories:', error);
      res.json({
        success: true,
        data: DEFAULT_SUBCATEGORIES.map((s, i) => ({
          id: `sub_${i + 1}`,
          name: s.name,
          slug: s.slug,
        })),
      });
    }
  }

  /**
   * GET /api/v1/qcommerce/shops
   */
  static async getShops(_req: Request, res: Response): Promise<void> {
    try {
      const onboardings = await QcSellerOnboarding.find({
        status: { $in: ['APPROVED', 'ACTIVE'] },
      })
        .select('shopName shopType city area address mobileNumber')
        .lean();

      const shopNames = new Set<string>();
      const shops: Array<{
        id: string;
        shopName: string;
        shopType?: string;
        city?: string;
        area?: string;
      }> = [];

      for (const o of onboardings as any[]) {
        if (o.shopName && !shopNames.has(o.shopName.toLowerCase())) {
          shopNames.add(o.shopName.toLowerCase());
          shops.push({
            id: String(o._id),
            shopName: o.shopName,
            shopType: o.shopType,
            city: o.city,
            area: o.area,
          });
        }
      }

      // Also ensure default shops from existing orders are included
      for (const s of DEFAULT_SHOPS) {
        if (!shopNames.has(s.shopName.toLowerCase())) {
          shopNames.add(s.shopName.toLowerCase());
          shops.push({
            id: `shop_${shops.length + 1}`,
            shopName: s.shopName,
            shopType: s.shopType,
            city: s.city,
            area: s.area,
          });
        }
      }

      res.json({
        success: true,
        data: shops,
      });
    } catch (error: any) {
      logger.error('Failed to fetch shops:', error);
      res.json({
        success: true,
        data: DEFAULT_SHOPS.map((s, i) => ({
          id: `shop_${i + 1}`,
          shopName: s.shopName,
          shopType: s.shopType,
          city: s.city,
          area: s.area,
        })),
      });
    }
  }
}
