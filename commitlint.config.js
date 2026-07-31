export default {
	extends: ['@commitlint/config-conventional'],
	plugins: ['commitlint-plugin-rai'],
	rules: {
		'rai-footer-exists': [2, 'always']
	}
};
