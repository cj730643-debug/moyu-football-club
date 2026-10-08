import ts from 'typescript-eslint';
export default [...ts.configs.recommended, { files: ['**/*.ts','**/*.tsx'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], '@typescript-eslint/no-explicit-any': 'error' } }, { ignores: ['.next/**','vendor/**','supabase/functions/**'] }];
