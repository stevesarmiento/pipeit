import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/coverage/**',
            '**/.turbo/**',
            'examples/next-js/**',
            'packages/fastlane/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['packages/core/src/**/*.ts', 'packages/actions/src/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/no-this-alias': 'off',
            'no-useless-catch': 'off',
            'preserve-caught-error': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        files: ['packages/**/src/**/__tests__/**/*.ts'],
        rules: {
            '@typescript-eslint/no-unused-vars': 'off',
        },
    },
);
