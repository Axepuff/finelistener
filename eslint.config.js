import eslint from '@eslint/js';
import ts_eslint from 'typescript-eslint';
import stylisticPlugin from '@stylistic/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import * as importPlugin from 'eslint-plugin-import';

export default ts_eslint.config({
    ignores: [
        'node_modules',
        'dist',
        'coverage',
        'whisper.cpp',
        '**/*.config.{js,ts,mts}',
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
            },
        },
        ...ts_eslint.configs.recommendedTypeChecked,
        {
            name: 'override/typescript-eslint',
            rules: {
                '@typescript-eslint/explicit-function-return-type': 'off',
                '@typescript-eslint/naming-convention': 'off',
                '@typescript-eslint/no-shadow': 'error',
                "@typescript-eslint/no-misused-promises": "off",
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
        stylisticPlugin.configs['disable-legacy'],
        {
            name: '@stylistic',
            plugins: {
                '@stylistic': stylisticPlugin,
            },
            rules: {
                '@stylistic/semi': ['error', 'always'],
                '@stylistic/indent': ['warn', 4, { 'SwitchCase': 1 }],
                '@stylistic/comma-dangle': ['warn', 'always-multiline'],
                '@stylistic/key-spacing': ['warn'],
                '@stylistic/padding-line-between-statements': [
                    'warn',
                    { 'blankLine': 'always', 'prev': '*', 'next': 'return' },
                    { 'blankLine': 'always', 'prev': ['const', 'let', 'var'], 'next': '*' },
                    { 'blankLine': 'any', 'prev': ['const', 'let', 'var'], 'next': ['const', 'let', 'var'] }
                ],
                '@stylistic/max-len': [
                    'warn',
                    {
                        'code': 120,
                        'tabWidth': 4,
                        'ignoreComments': true,
                        'ignoreTrailingComments': true,
                        'ignoreUrls': true,
                        'ignoreRegExpLiterals': true,
                        'ignoreStrings': true,
                        'ignoreTemplateLiterals': true,
                    },
                ],
                '@stylistic/quotes': ['warn', 'single', { 'avoidEscape': true }],
                '@stylistic/object-curly-newline': ['warn', {
                    ObjectExpression: { multiline: true, consistent: true },
                    ObjectPattern: { multiline: true, consistent: true },
                    ImportDeclaration: { multiline: true, consistent: true },
                    ExportDeclaration: { multiline: true, consistent: true },
                }],
                '@stylistic/object-curly-spacing': ['warn', 'always'],
                '@stylistic/quote-props': ['warn', 'as-needed'],
                '@stylistic/space-infix-ops': ['warn'],
                '@stylistic/keyword-spacing': ['warn'],
                '@stylistic/no-multiple-empty-lines': ['warn', {
                    'max': 1,
                    'maxEOF': 1,
                    'maxBOF': 0,
                }],
                '@stylistic/eol-last': 'warn',
                '@stylistic/block-spacing': 'warn',
                '@stylistic/comma-spacing': 'warn',
                '@stylistic/no-multi-spaces': 'warn',
                '@stylistic/space-before-blocks': 'warn',
                '@stylistic/space-in-parens': 'warn',
                '@stylistic/no-trailing-spaces': 'warn',
                '@stylistic/jsx-quotes': ['warn', 'prefer-double'],
                '@stylistic/jsx-child-element-spacing': 'warn',
                '@stylistic/jsx-closing-bracket-location': 'warn',
                '@stylistic/jsx-closing-tag-location': 'warn',
                '@stylistic/jsx-curly-brace-presence': ['warn', { props: 'never', children: 'always', propElementValues: 'always' }],
                '@stylistic/jsx-curly-newline': ['warn', 'never'],
                '@stylistic/jsx-curly-spacing': ['warn', { when: 'never' }],
                '@stylistic/jsx-equals-spacing': ['warn', 'never'],
                '@stylistic/jsx-one-expression-per-line': ['warn', { allow: 'single-child' }],
                '@stylistic/jsx-pascal-case': 'error',
                '@stylistic/jsx-props-no-multi-spaces': 'warn',
                '@stylistic/jsx-tag-spacing': 'warn',
                '@stylistic/type-annotation-spacing': 'warn',
                '@stylistic/member-delimiter-style': 'warn',
            },
        },
    ],
});
