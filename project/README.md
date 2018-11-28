# Projeto Computacao em Nuvem - Insper 2018
<b>Frederico Curti - Prof. Raul Ikeda</b>
___

### Objetivo
O objetivo desse projeto era colocar em prática alguns dos aprendizados durante o semestre, e construir um programa capaz de realizar a implantação completa de um microserviço web, com um Load Balancer 'feito à mão' e um serviço capaz de monitorar a saúde das instâncias e substitituí-las em caso de falha.

### Instalação e uso

Para usar o serviço, clone esse repositório e instale as dependências necessárias para rodar o sub-projeto `project`
```bash
git clone https://github.com/fredericocurti/cloud-2018
cd cloud-2018/project
npm install
```

Feito isso, basta executar o programa
```bash
npm run deploy
```

Esse programa irá pedir pelas credenciais necessárias da AWS, armazená-las no arquivo `credentials.js` e realizar todo o processo, que envolve limpar instâncias existentes que possam interferir com o projeto e lançar o Load Balancer em uma nova instância.

- Ao executar remotamente, a instância responsável pelo `LoadBalancer.js`, identificada com a tag `Type: loadbalancer` irá lançar o número de instâncias especificadas com o programa em python da [APS1](/../aps1/rest.py), redirecionar as solicitações que receber em seu IP público aleatoriamente para essas instâncias e checar periodicamente através do subprocesso contido no arquivo [`healthcheck.js`](healthcheck.js) pela saúde dessas instâncias, de forma que se algum problema ocorrer (timeout, por exemplo) na tentativa de chamar a rota `/healthcheck`, essa instância será substituida na intenção de manter a exata quantidade de instâncias solicitadas em funcionamento.

___
### Limpando
- Caso queira terminar as instancias e deletar as credencias criadas com o projeto:
```bash
npm run purge
```