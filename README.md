# Prévu pour fonctionner avec les APIs OpenAI

## Pour ajouter le fichier config.js :
    export const OPENAI_API_KEY = "sk-TA_CLE_ICI";


## Pour ajouter l'extension :
dans vos extensions chrome > activer le mode développeur > Charger l'extension non empaquetée

## Pour définir un raccourci :
dans vos extensions chrome > raccourcis clavier

## Pour afficher output :
alt appuyé + souris inactive sur le fond de la page (bouger le curseur pour actualiser)

## Pour modifier nb lignes output :
css :
```
-webkit-line-clamp: //nblignes//;
```



## Pricing
### price for 1M Tokens [https://developers.openai.com/api/docs/pricing](Details)
cons : ~5K Tokens/utilisation
```
Model	            Input	Cached Input    Output
gpt-5.2	            $0.875	$0.0875	        $7.00
gpt-5.1	            $0.625	$0.0625	        $5.00
gpt-5	            $0.625	$0.0625	        $5.00
gpt-5-mini	        $0.125	$0.0125	        $1.00
gpt-5-nano	        $0.025	$0.0025	        $0.20
gpt-5.2-pro	        $10.50	-	            $84.00
gpt-5-pro	        $7.50	-	            $60.00
gpt-4.1	            $1.00	-	            $4.00
gpt-4.1-mini	    $0.20	-	            $0.80
gpt-4.1-nano	    $0.05	-	            $0.20
gpt-4o	            $1.25	-	            $5.00
gpt-4o-2024-05-13	$2.50	-	            $7.50
gpt-4o-mini	        $0.075	-	            $0.30
o1	                $7.50	-	            $30.00
```