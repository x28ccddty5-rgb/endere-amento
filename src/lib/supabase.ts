import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      // A sessão fica somente na memória desta abertura do aplicativo.
      // Ao recarregar a página, o operador deverá autenticar novamente.
      // Os dados operacionais continuam persistidos no Supabase.
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
)
