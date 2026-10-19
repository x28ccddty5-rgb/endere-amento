import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

// Falha cedo e com uma mensagem acionável, em vez de deixar createClient lançar
// apenas "supabaseUrl is required" ou "supabaseKey is required".
const missingVariables = [
  !supabaseUrl ? 'VITE_SUPABASE_URL' : null,
  !supabaseAnonKey ? 'VITE_SUPABASE_ANON_KEY' : null,
].filter((variable): variable is string => variable !== null);

if (missingVariables.length > 0) {
  const message =
    `[Configuração do Supabase] Variável(is) ausente(s): ${missingVariables.join(', ')}. ` +
    'Configure-as no arquivo .env.local para desenvolvimento ou nas Environment Variables ' +
    'do ambiente de build/publicação (por exemplo, Production no Vercel) e gere um novo build.';

  // Mantém a causa clara no console mesmo antes da criação do cliente.
  console.error(message);
  throw new Error(message);
}

// Rejeita URLs malformadas também; createClient requer uma URL de API válida.
try {
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('protocolo inválido');
  }
} catch {
  throw new Error(
    '[Configuração do Supabase] VITE_SUPABASE_URL não é uma URL válida. ' +
    'Use o endereço HTTPS do projeto Supabase (ou a URL HTTP local de desenvolvimento).'
  );
}

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
);
