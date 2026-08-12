// =========================================================
// KONFIGURASI SUPABASE
// Ganti dua nilai di bawah ini dengan milikmu:
// Dashboard Supabase > Project Settings > API
// =========================================================
export const SUPABASE_URL = "https://dcepjhqonscvgxhegkcb.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjZXBqaHFvbnNjdmd4aGVna2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NTkwNTUsImV4cCI6MjEwMjEzNTA1NX0.Ccc_DsaqURN19zaIDj_PUyiu9YW9odsrGGvCUNk1Rlc";

// Client global Supabase (library dimuat lewat CDN di index.html
// sehingga tersedia sebagai window.supabase)
export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

export const BUCKET_MEDIA = "chat-media";
export const BUCKET_STICKERS = "stickers";
