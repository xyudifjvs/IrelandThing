import 'dotenv/config';
import {defineConfig} from 'prisma/config';
export default defineConfig({schema:'packages/db/prisma/schema.prisma',migrations:{path:'packages/db/prisma/migrations'},datasource:{url:process.env.DATABASE_URL || 'postgresql://weatherly:weatherly_local@localhost:55432/weatherly'}});
