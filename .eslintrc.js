import eslint from '@eslint/js';
import ts_eslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import * as importPlugin from 'eslint-plugin-import';

export default ts_eslint.config({
    ignores: [
        'node_modules',
        'dist',
        'coverage'
    ],
}, {
    languageOptions: {
        parser: ts_eslint.parser,
        parserOptions: {
            projectService: true,
            tsconfigRootDir: import.meta.dirname,
            ecmaVersion: 2020,
            ecmaFeatures: {
                jsx: true,
            },
        },
    },
    settings: {
        react: {
            version: 'detect',
        },
    },
    extends: [
        eslint.configs.recommended,
        {
            name: 'override/eslint',
            rules: {
                'eqeqeq': 'warn',
                'no-else-return': ['warn', { allowElseIf: false }],
                'no-param-reassign': ['error', {
                    'props': true,
                    'ignorePropertyModificationsFor': ['acc'],
                }],
                'no-restricted-globals': [
                    'error',
                    'event',
                    'location',
                    'Text',
                    'Comment',
                ],
                'no-undef': 'off',
                'no-unneeded-ternary': 'warn',
                'no-useless-escape': 'off',
                'prefer-promise-reject-errors': 'error',
            },
        },
        ...ts_eslint.configs.recommendedTypeChecked,
        {
            name: 'override/typescript-eslint',
            rules: {
                '@typescript-eslint/explicit-function-return-type': 'off',
                '@typescript-eslint/naming-convention': 'off',
                '@typescript-eslint/no-shadow': 'error',
                '@typescript-eslint/no-unused-vars': [
                    'warn',
                    {
                        'args': 'all',
                        'argsIgnorePattern': '^_',
                        'caughtErrors': 'all',
                        'caughtErrorsIgnorePattern': '^_',
                        'destructuredArrayIgnorePattern': '^_',
                        'varsIgnorePattern': '^_',
                        'ignoreRestSiblings': true,
                    }
                ],
                '@typescript-eslint/no-empty-interface': 'off',
                '@typescript-eslint/no-explicit-any': 'off',
                // TODO: enable by chunk
                // '@typescript-eslint/no-unnecessary-condition': 'error',
                '@typescript-eslint/no-use-before-define': 'off',
                '@typescript-eslint/no-unsafe-enum-comparison': 'off',
            }
        },
        {
            name: 'override/import',
            plugins: {
                'import': importPlugin,
            },
            rules: {
                'import/newline-after-import': 'warn',
                'import/no-default-export': 'error',
                'import/order': ['warn', {
                    'alphabetize': { order: 'asc', caseInsensitive: false },
                    'newlines-between': 'never',
                }],
            },
        },
        reactPlugin.configs.flat.recommended,
        reactPlugin.configs.flat['jsx-runtime'],
        {
            name: 'override/react',
            rules: {
                'react/display-name': 'off',
                'react/function-component-definition': 'off',
                'react/jsx-boolean-value': ['error', 'always'],
                'react/jsx-filename-extension': 'off',
                'react/jsx-fragments': ['error', 'element'],
                'react/jsx-no-constructed-context-values': 'error',
                'react/jsx-no-leaked-render': ['error', { 'validStrategies': ['ternary'] }],
                'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
                'react/prop-types': 'off',
                'react/require-default-props': 'off',
            },
        },
        {
            name: 'react-hooks',
            plugins: {
                'react-hooks': reactHooksPlugin,
            },
            rules: {
                'react-hooks/rules-of-hooks': 'error',
                'react-hooks/exhaustive-deps': 'warn',
            },
        },
        {
            name: 'override/test',
            files: ['src/**/*.test.tsx'],
            rules: {
                'react/display-name': 'off',
            },
        },
        {
            name: 'override/spec',
            files: ['src/**/*.spec.tsx'],
            rules: {
                '@typescript-eslint/unbound-method': 'off',
            },
        },
        {
            name: 'override/stories',
            files: ['src/**/*.stories.tsx'],
            rules: {
                'import/no-default-export': 'off',
            },
        },
    ],
});
