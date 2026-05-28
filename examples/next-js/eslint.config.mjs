import nextVitals from 'eslint-config-next/core-web-vitals';

const eslint10Parser = parser => ({
    ...parser,
    parseForESLint(...args) {
        const result = parser.parseForESLint(...args);

        if (result.scopeManager && typeof result.scopeManager.addGlobals !== 'function') {
            result.scopeManager.addGlobals = names => {
                const globalScope = result.scopeManager.globalScope ?? result.scopeManager.scopes[0];
                globalScope?.addVariables?.(names);
                globalScope?.__addVariables?.(names);

                for (const name of names) {
                    if (!globalScope?.set?.has?.(name)) {
                        const variable = {
                            name,
                            identifiers: [],
                            references: [],
                            defs: [],
                            scope: globalScope,
                        };

                        globalScope?.set?.set?.(name, variable);
                        globalScope?.variables?.push?.(variable);
                    }
                }
            };
        }

        return result;
    },
});

const nextConfigs = nextVitals.map(config => {
    if (!config.languageOptions) {
        return config;
    }

    const { globals: _globals, parser, ...languageOptions } = config.languageOptions;

    if (parser) {
        languageOptions.parser = eslint10Parser(parser);
    }

    return { ...config, languageOptions };
});

const eslintConfig = [
    ...nextConfigs,
    {
        ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
    },
    {
        settings: {
            react: {
                version: '19.2.6',
            },
        },
        rules: {
            'react-hooks/purity': 'off',
            'react-hooks/refs': 'off',
            'react-hooks/set-state-in-effect': 'off',
            'react/no-unescaped-entities': 'off',
        },
    },
];

export default eslintConfig;
