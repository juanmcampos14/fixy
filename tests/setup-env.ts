import { config } from "dotenv";
config({ path: ".env.example", quiet: true });
config({ path: ".env.local", override: true, quiet: true });
// Las pruebas siempre usan la base de pruebas y el adaptador de pagos simulado.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
process.env.PAYMENTS_GATEWAY = "mock";
process.env.STORAGE_DIR = "./.data/test-storage";
